/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The speaker's drawing on the current-frame preview (#521). The pointer goes to the presenter
// page where the preview is: a mouse through Playwright, a stylus through CDP mouse events with
// `pointerType: "pen"` and a force, a finger through CDP touch events. Chromium hit-tests each
// one into the preview's iframe, as it would a real one. What the audience window then shows
// is read by the steps of drawings.steps.js.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {expect} from "playwright/test";
import {CURRENT, LAYER, WAIT, contentOf, currentPreviewDeck} from "../support/panels.js";

/** How many moves a drag across an element is cut into. */
const DRAG_STEPS = 12;

/** Where across an element a drag runs, as a share of its height from its top. */
const ROWS = Object.freeze({top: 0.25, middle: 0.5, bottom: 0.75});

/** @typedef {{x: number, y: number}} Point */

/** How far down an element a row the scenarios name runs.
 *
 * @param {string} row - `top`, `middle` or `bottom`.
 * @returns {number} - The share of the element's height from its top.
 */
function rowShare(row) {
    const share = /** @type {Record<string, number>} */ (ROWS)[row];
    assert.ok(share !== undefined, `the scenarios know no part "${row}" of an element`);
    return share;
}

/** The line across an element of the current-frame preview, in the presenter page's pixels.
 *
 * It runs left to right, from a tenth of the element's width to nine tenths of it.
 *
 * @param {import("playwright").Page} page - A presenter page.
 * @param {string} elementId - The element's id in the deck.
 * @param {string} row - `top`, `middle` or `bottom`: how far down the element.
 * @returns {Promise<Point[]>} - The points of the line, `DRAG_STEPS + 1` of them.
 */
async function lineAcross(page, elementId, row) {
    const share = rowShare(row);
    const deck = await currentPreviewDeck(page);
    const box = await page.locator(CURRENT).boundingBox(WAIT);
    assert.ok(box, "the current-frame preview is laid out");
    const {rect, width} = await deck.evaluate(id => {
        const element = document.getElementById(id);
        if (!element) {
            throw new Error(`the deck has no element "${id}"`);
        }
        const r = element.getBoundingClientRect();
        return {rect: {x: r.x, y: r.y, width: r.width, height: r.height}, width: innerWidth};
    }, elementId);
    // The iframe's pixels to the page's: the iframe may be drawn at another scale.
    const k = box.width / width;
    const y = box.y + (rect.y + rect.height * share) * k;
    return Array.from({length: DRAG_STEPS + 1}, (_, i) => ({
        x: box.x + (rect.x + rect.width * (0.1 + (0.8 * i) / DRAG_STEPS)) * k,
        y
    }));
}

/** A CDP session on the presenter page, opened once per presenter page.
 *
 * @param {any} world - The scenario's world.
 * @returns {Promise<import("playwright").CDPSession>} - The session.
 */
async function presenterCdp(world) {
    if (world.presenterCdp?.page !== world.presenter) {
        world.presenterCdp = {
            page: world.presenter,
            session: await world.context.newCDPSession(world.presenter)
        };
    }
    return world.presenterCdp.session;
}

/** Drag the mouse along a line on the presenter page.
 *
 * @param {import("playwright").Page} page - A presenter page.
 * @param {Point[]} line - The points the mouse passes through.
 */
async function mouseAlong(page, line) {
    await page.mouse.move(line[0].x, line[0].y);
    await page.mouse.down();
    for (const point of line.slice(1)) {
        await page.mouse.move(point.x, point.y);
    }
    await page.mouse.up();
}

/** Drag a stylus along a line on the presenter page, pressing harder as it goes.
 *
 * @param {any} world - The scenario's world.
 * @param {Point[]} line - The points the stylus passes through.
 */
async function stylusAlong(world, line) {
    const cdp = await presenterCdp(world);
    const last = line.length - 1;
    /** One stylus event.
     *
     * @param {"mousePressed"|"mouseMoved"|"mouseReleased"} type - `mousePressed`, `mouseMoved` or `mouseReleased`.
     * @param {Point} point - Where the stylus is.
     * @param {number} force - How hard it presses, 0 to 1.
     * @returns {Promise<unknown>} - Resolves when the page has the event.
     */
    const pen = (type, point, force) =>
        cdp.send("Input.dispatchMouseEvent", {
            type,
            x: point.x,
            y: point.y,
            button: "left",
            buttons: type === "mouseReleased" ? 0 : 1,
            clickCount: 1,
            pointerType: "pen",
            force
        });
    await pen("mousePressed", line[0], 0.2);
    for (const [i, point] of line.entries()) {
        await pen("mouseMoved", point, Math.min(1, 0.2 + (0.8 * i) / last));
    }
    await pen("mouseReleased", line[last], 0);
}

/** Drag one finger along a line on the presenter page.
 *
 * @param {any} world - The scenario's world.
 * @param {Point[]} line - The points the finger passes through.
 */
async function fingerAlong(world, line) {
    const cdp = await presenterCdp(world);
    const [first, ...rest] = line;
    await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{x: first.x, y: first.y, id: 0}]
    });
    for (const point of rest) {
        await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{x: point.x, y: point.y, id: 0}]
        });
    }
    await cdp.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
}

/** A button of the current-frame preview's toolbar, named exactly.
 *
 * @param {import("playwright").Page} page - A presenter page.
 * @param {string} name - The button's name.
 * @returns {import("playwright").Locator} - The button.
 */
function toolbarButton(page, name) {
    return contentOf(page, "Current").getByRole("button", {name, exact: true});
}

When("a mouse drags across {string} on the current-frame preview", async function (elementId) {
    await mouseAlong(this.presenter, await lineAcross(this.presenter, elementId, "middle"));
});

When(
    "a mouse drags across the {word} of {string} on the current-frame preview",
    async function (row, elementId) {
        await mouseAlong(this.presenter, await lineAcross(this.presenter, elementId, row));
    }
);

When(
    "a stylus drags across {string} on the current-frame preview with rising pressure",
    async function (elementId) {
        await stylusAlong(this, await lineAcross(this.presenter, elementId, "middle"));
    }
);

When("a finger drags across {string} on the current-frame preview", async function (elementId) {
    await fingerAlong(this, await lineAcross(this.presenter, elementId, "middle"));
});

Given("the {string} panel's toolbar is in pan mode", async function (title) {
    assert.equal(title, "Current", "only the current-frame preview has a drawing toolbar");
    // Draw mode is off: the toggle says so, as a screen reader says it.
    await expect(toolbarButton(this.presenter, "Draw")).toHaveAttribute(
        "aria-pressed",
        "false",
        WAIT
    );
});

Then("the {string} panel's toolbar shows {string}", async function (title, name) {
    assert.equal(title, "Current", "only the current-frame preview has a drawing toolbar");
    await expect(toolbarButton(this.presenter, name)).toBeVisible(WAIT);
});

Then(
    "the stroke in the audience window lies over the {word} of {string}",
    async function (row, elementId) {
        const share = rowShare(row);
        await expect
            .poll(
                () =>
                    this.audience.evaluate(([selector, id, at]) => {
                        const strokes = Array.from(
                            document.querySelectorAll(`${selector} path`)
                        ).filter(path =>
                            path.checkVisibility({
                                opacityProperty: true,
                                visibilityProperty: true
                            })
                        );
                        const element = document.getElementById(String(id));
                        if (strokes.length !== 1 || !element) {
                            return `${strokes.length} strokes shown`;
                        }
                        const s = strokes[0].getBoundingClientRect();
                        const e = element.getBoundingClientRect();
                        // The stroke's middle is nearer this row than any other.
                        const found = (s.y + s.height / 2 - e.y) / e.height;
                        return Math.abs(found - Number(at)) < 0.125 ? "there" : `at ${found}`;
                    }, /** @type {[string, string, number]} */ ([LAYER, elementId, share])),
                WAIT
            )
            .toBe("there");
    }
);
