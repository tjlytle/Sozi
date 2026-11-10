/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for panning and zooming the audience window from the current-frame preview: the
// gestures on the preview or on the audience window, the camera they leave, and the
// "Back to frame" button. Views are compared in viewport units, the share of the window's
// width and height, so that a preview and the audience window of other sizes agree.

import {Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {expect} from "playwright/test";
import {WAIT} from "./workspace.steps.js";

/** The iframe of the current-frame preview. */
const CURRENT = ".sozi-current-frame";

/** The box the current-frame preview draws into, which holds its button. */
const CURRENT_BOX = `.sozi-preview-box:has(> ${CURRENT})`;

/** How many moves a drag is cut into, so that it passes any drag threshold on the way. */
const DRAG_STEPS = 10;

/** How far a share of the window may be off, in viewport units. */
const SHARE_TOLERANCE = 0.01;

/** How far the point under a zoom may drift, in pixels of the audience window. */
const DRIFT_TOLERANCE_PX = 2;

/** @typedef {{x: number, y: number}} Point */
/** @typedef {{cx: number, cy: number, scale: number, width: number, height: number}} CameraReading */

/** The first camera of a deck page and the size of its viewport.
 *
 * @param {import("playwright").Page|import("playwright").Frame} page - A page or frame with
 *     a deck in it.
 * @returns {Promise<{camera: CameraReading, vw: number, vh: number}>} - The reading.
 */
function readCamera(page) {
    return page.evaluate(() => {
        const {viewport} = /** @type {any} */ (window).sozi;
        const {cx, cy, scale, width, height} = viewport.cameras[0];
        return {camera: {cx, cy, scale, width, height}, vw: viewport.width, vh: viewport.height};
    });
}

/** Where a deck's first camera looks, relative to its current frame, in viewport units.
 *
 * `zoom` is the camera's scale over the frame's; `x` and `y` are where the frame's centre
 * shows, from the viewport's centre, as a share of its width and height.
 *
 * @param {import("playwright").Page|import("playwright").Frame} page - A page or frame with
 *     a deck in it.
 * @returns {Promise<{zoom: number, x: number, y: number}>} - The view.
 */
function relativeView(page) {
    return page.evaluate(() => {
        const {viewport, player} = /** @type {any} */ (window).sozi;
        const camera = viewport.cameras[0];
        const frame = player.currentFrame.cameraStates[0];
        const vw = viewport.width;
        const vh = viewport.height;
        const frameScale = Math.min(vw / frame.width, vh / frame.height);
        return {
            zoom: camera.scale / frameScale,
            x: ((frame.cx - camera.cx) * camera.scale) / vw,
            y: ((frame.cy - camera.cy) * camera.scale) / vh
        };
    });
}

/** The deck inside a page's current-frame preview, once it shows its frame.
 *
 * @param {import("playwright").Page} page - A presenter page.
 * @returns {Promise<import("playwright").Frame>} - The preview's window.
 */
async function currentPreviewDeck(page) {
    const iframe = await page.locator(CURRENT).elementHandle(WAIT);
    const frame = await iframe?.contentFrame();
    assert.ok(frame, "the current-frame preview has a window");
    await frame.waitForFunction(
        () => Boolean(/** @type {any} */ (window).sozi?.player?.currentFrame),
        null,
        WAIT
    );
    return frame;
}

/** The box of the current-frame preview on a page, once its deck is ready.
 *
 * @param {import("playwright").Page} page - A presenter page.
 * @returns {Promise<{x: number, y: number, width: number, height: number}>} - The iframe's
 *     box, in the page's pixels.
 */
async function currentPreviewBox(page) {
    await currentPreviewDeck(page);
    const box = await page.locator(CURRENT).boundingBox(WAIT);
    assert.ok(box, "the current-frame preview is laid out");
    return box;
}

/** Drag the mouse from a point by a distance, in even steps.
 *
 * @param {import("playwright").Page} page - The page to drag on.
 * @param {Point} from - Where the drag starts.
 * @param {Point} by - How far it goes.
 */
async function drag(page, from, by) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + by.x, from.y + by.y, {steps: DRAG_STEPS});
    await page.mouse.up();
}

/** The "Back to frame" button of a page's current-frame preview.
 *
 * @param {import("playwright").Page} page - A presenter page.
 * @returns {import("playwright").Locator} - The button.
 */
function backToFrame(page) {
    return page.locator(CURRENT_BOX).getByRole("button", {name: "Back to frame"});
}

When("the current-frame preview is dragged {int} pixels to the left", async function (distance) {
    const box = await currentPreviewBox(this.presenter);
    this.panStart = {before: await readCamera(this.audience), share: distance / box.width};
    const centre = {x: box.x + box.width / 2, y: box.y + box.height / 2};
    await drag(this.presenter, centre, {x: -distance, y: 0});
});

When("the audience window's slide is dragged {int} pixels to the left", async function (distance) {
    const {vw, vh} = await readCamera(this.audience);
    await drag(this.audience, {x: vw / 2, y: vh / 2}, {x: -distance, y: 0});
});

When(
    "the wheel turns up over the current-frame preview at its top-left quarter",
    async function () {
        const box = await currentPreviewBox(this.presenter);
        this.zoomStart = await readCamera(this.audience);
        await this.presenter.mouse.move(box.x + box.width / 4, box.y + box.height / 4);
        await this.presenter.mouse.wheel(0, -100);
    }
);

When("two fingers spread apart on the current-frame preview", async function () {
    const box = await currentPreviewBox(this.presenter);
    this.zoomStart = await readCamera(this.audience);
    const cdp = await this.context.newCDPSession(this.presenter);
    await cdp.send("Emulation.setTouchEmulationEnabled", {enabled: true, maxTouchPoints: 2});
    const centre = {x: box.x + box.width / 2, y: box.y + box.height / 2};
    const reach = box.width / 3;
    /** Put both fingers at a distance from the centre, on either side.
     *
     * @param {"touchStart"|"touchMove"} type - The touch event.
     * @param {number} offset - How far each finger is from the centre.
     * @returns {Promise<unknown>} - Resolves when the page has the event.
     */
    const fingers = (type, offset) =>
        cdp.send("Input.dispatchTouchEvent", {
            type,
            touchPoints: [
                {x: centre.x - offset, y: centre.y, id: 0},
                {x: centre.x + offset, y: centre.y, id: 1}
            ]
        });
    await fingers("touchStart", 20);
    for (let step = 1; step <= DRAG_STEPS; step++) {
        await fingers("touchMove", 20 + ((reach - 20) * step) / DRAG_STEPS);
    }
    await cdp.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
});

When("{string} is pressed", async function (name) {
    assert.equal(name, "Back to frame");
    await backToFrame(this.presenter).click(WAIT);
});

When("{string} is pressed on the second surface", async function (name) {
    assert.equal(name, "Back to frame");
    await backToFrame(this.secondSurface).click(WAIT);
});

When("the link {string} in the current-frame preview is clicked", async function (id) {
    const deck = await currentPreviewDeck(this.presenter);
    await deck.locator(`#${id}`).click(WAIT);
});

Then(
    "the audience window has panned by the same share of its width as the preview",
    async function () {
        const {before, share} = this.panStart;
        // A pan to the left moves the camera to the right, by the share over the scale.
        // The poll's value is the pan itself, so a failure says how far the window moved.
        await expect
            .poll(async () => {
                const {camera, vw, vh} = await readCamera(this.audience);
                const x = ((camera.cx - before.camera.cx) * camera.scale) / vw;
                const y = ((camera.cy - before.camera.cy) * camera.scale) / vh;
                const near = Math.abs(x - share) <= SHARE_TOLERANCE;
                return {x: near ? share : x, y: Math.abs(y) <= SHARE_TOLERANCE ? 0 : y};
            }, WAIT)
            .toEqual({x: share, y: 0});
    }
);

Then("the audience window is zoomed in about the point at its top-left quarter", async function () {
    const {camera: before, vw, vh} = this.zoomStart;
    const point = {x: vw / 4, y: vh / 4};
    /** The deck point under the screen point, for a camera.
     *
     * @param {CameraReading} camera - The camera.
     * @returns {Point} - The deck point.
     */
    const under = camera => ({
        x: camera.cx + (point.x - vw / 2) / camera.scale,
        y: camera.cy + (point.y - vh / 2) / camera.scale
    });
    await expect
        .poll(async () => {
            const {camera} = await readCamera(this.audience);
            const was = under(before);
            const now = under(camera);
            const drift = Math.hypot(now.x - was.x, now.y - was.y) * camera.scale;
            return {zoomedIn: camera.scale > before.scale, fixed: drift <= DRIFT_TOLERANCE_PX};
        }, WAIT)
        .toEqual({zoomedIn: true, fixed: true});
});

Then("the view is zoomed in on the audience window", async function () {
    const before = this.zoomStart.camera.scale;
    await expect
        .poll(async () => (await readCamera(this.audience)).camera.scale / before, WAIT)
        .toBeGreaterThan(1.05);
});

Then("the current-frame preview shows the audience window's view", async function () {
    const deck = await currentPreviewDeck(this.presenter);
    await expect
        .poll(async () => {
            const room = await relativeView(this.audience);
            const preview = await relativeView(deck);
            return [
                Math.abs(preview.zoom / room.zoom - 1),
                Math.abs(preview.x - room.x),
                Math.abs(preview.y - room.y)
            ].every(gap => gap <= SHARE_TOLERANCE);
        }, WAIT)
        .toBe(true);
});

Then("the current-frame preview shows {string}", async function (name) {
    assert.equal(name, "Back to frame");
    await expect(backToFrame(this.presenter)).toBeVisible(WAIT);
});

Then("the second surface's current-frame preview shows {string}", async function (name) {
    assert.equal(name, "Back to frame");
    await expect(backToFrame(this.secondSurface)).toBeVisible(WAIT);
});

Then("the current-frame preview shows no {string}", async function (name) {
    assert.equal(name, "Back to frame");
    // The button is in the preview but hidden, so a preview without one does not pass.
    const button = backToFrame(this.presenter);
    await expect(button).toHaveCount(1, WAIT);
    await expect(button).toBeHidden(WAIT);
});

Then("the audience window's camera is on frame {string}", async function (title) {
    await expect
        .poll(
            () =>
                this.audience.evaluate(() => {
                    const {viewport, player} = /** @type {any} */ (window).sozi;
                    const frame = player.currentFrame;
                    const off = viewport.cameras.filter((/** @type {any} */ camera, i) => {
                        const state = frame.cameraStates[i];
                        return ["cx", "cy", "width", "height"].some(
                            key => Math.abs(camera[key] - state[key]) > 0.5
                        );
                    });
                    return {title: frame.title, camerasOffFrame: off.length};
                }),
            WAIT
        )
        .toEqual({title, camerasOffFrame: 0});
});
