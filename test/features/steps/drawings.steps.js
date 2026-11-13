/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the drawings on the audience window: a second surface sends the stroke messages
// over its bridge to the display, and the steps read the drawing layer of the audience window
// and of the previews. A stroke is a path under `.sozi-drawing`; the highlighter group comes
// before the pen group, so a highlighter is painted under every pen stroke.

import {Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {expect} from "playwright/test";
import {WAIT} from "../support/panels.js";

/** What the second surface calls to reach the display (see `second-surface.steps.js`). */
const TO_DISPLAY = "secondSurfaceToDisplay";

/** The drawing layer the display adds to its SVG. */
const LAYER = ".sozi-drawing";

/** The colours the scenarios name, as the `#rrggbb` the protocol takes. */
const COLOURS = Object.freeze({
    red: "#ff0000",
    blue: "#0000ff",
    green: "#00aa00",
    yellow: "#ffff00"
});

/** The base width of a stroke, in canvas units. */
const WIDTH = 6;

/** How many points a stroke across an element has. */
const POINT_COUNT = 20;

/** The pressure every point of a scenario's stroke has: a mouse's constant. */
const PRESSURE = 0.5;

/** The colour of a scenario's name, as the protocol takes it.
 *
 * @param {string} name - A colour the scenarios name.
 * @returns {string} - Its `#rrggbb`.
 */
function colourOf(name) {
    const colour = /** @type {Record<string, string>} */ (COLOURS)[name];
    assert.ok(colour, `the scenarios know no colour "${name}"`);
    return colour;
}

/** The same colour as `getComputedStyle` writes it.
 *
 * @param {string} hex - A `#rrggbb` colour.
 * @returns {string} - It as `rgb(r, g, b)`.
 */
function computedColour(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${r}, ${g}, ${b})`;
}

/** Send a message from the second surface to the display, through its bridge.
 *
 * It resolves once the display has handled the message.
 *
 * @param {any} world - The scenario's world.
 * @param {any} message - The message.
 */
async function sendFromSurface(world, message) {
    await world.secondSurface.evaluate(
        ([send, sent]) => /** @type {any} */ (window)[send](sent),
        [TO_DISPLAY, message]
    );
}

/** Points across an element of the deck, in canvas units, left to right through its middle.
 *
 * @param {import("playwright").Page} page - The audience window.
 * @param {string} id - The element's id.
 * @returns {Promise<number[][]>} - The points, `[x, y, pressure]` each.
 */
function pointsAcross(page, id) {
    return page.evaluate(([elementId, count, pressure]) => {
        const element = /** @type {SVGGraphicsElement|null} */ (
            document.getElementById(String(elementId))
        );
        if (!element) {
            throw new Error(`the deck has no element "${elementId}"`);
        }
        const box = element.getBBox();
        return Array.from({length: Number(count)}, (_, i) => {
            const share = 0.1 + (0.8 * i) / (Number(count) - 1);
            const wave = Math.sin(share * Math.PI * 4) * box.height * 0.1;
            return [box.x + share * box.width, box.y + box.height / 2 + wave, pressure];
        });
    }, /** @type {[string, number, number]} */ ([id, POINT_COUNT, PRESSURE]));
}

/** Begin a stroke from the second surface, and send it all its points but not its end.
 *
 * @param {any} world - The scenario's world.
 * @param {string} colourName - The colour the scenario names.
 * @param {string} tool - `pen` or `highlighter`.
 * @param {string} elementId - The element the stroke crosses.
 * @returns {Promise<string>} - The stroke's id.
 */
async function beginStroke(world, colourName, tool, elementId) {
    const id = `stroke-${colourName}-${tool}`;
    const points = await pointsAcross(world.audience, elementId);
    const half = Math.floor(points.length / 2);
    await sendFromSurface(world, {
        name: "strokeBegin",
        id,
        tool,
        color: colourOf(colourName),
        width: WIDTH,
        points: points.slice(0, half)
    });
    await sendFromSurface(world, {name: "strokePoints", id, points: points.slice(half)});
    world.strokeIds = {...world.strokeIds, [colourName]: id};
    return id;
}

/** The strokes of the drawing layer of a page or frame, as the eye sees them.
 *
 * `layer` is false while the page has no drawing layer; a stroke counts when it is rendered and
 * not hidden.
 *
 * @param {import("playwright").Page|import("playwright").Frame} page - A deck page or frame.
 * @returns {Promise<{layer: boolean, strokes: {fill: string}[]}>} - What it shows.
 */
function shownStrokes(page) {
    return page.evaluate(selector => {
        const layer = document.querySelector(selector);
        if (!layer) {
            return {layer: false, strokes: []};
        }
        const paths = Array.from(layer.querySelectorAll("path"));
        const shown = paths.filter(path =>
            path.checkVisibility({opacityProperty: true, visibilityProperty: true})
        );
        return {layer: true, strokes: shown.map(path => ({fill: getComputedStyle(path).fill}))};
    }, LAYER);
}

/** Wait until a page or frame shows a number of strokes in its drawing layer.
 *
 * @param {import("playwright").Page|import("playwright").Frame} page - A deck page or frame.
 * @param {number} count - How many strokes it should show.
 */
async function expectStrokeCount(page, count) {
    await expect
        .poll(async () => {
            const {layer, strokes} = await shownStrokes(page);
            return layer ? strokes.length : "no drawing layer";
        }, WAIT)
        .toBe(count);
}

/** The deck in a presenter page's current-frame preview, once it shows its frame.
 *
 * @param {import("playwright").Page} page - A presenter page.
 * @returns {Promise<import("playwright").Frame>} - The preview's window.
 */
async function currentPreviewDeck(page) {
    const iframe = await page.locator(".sozi-current-frame").elementHandle(WAIT);
    const frame = await iframe?.contentFrame();
    assert.ok(frame, "the current-frame preview has a window");
    await frame.waitForFunction(
        () => Boolean(/** @type {any} */ (window).sozi?.player?.currentFrame),
        null,
        WAIT
    );
    return frame;
}

When(
    "the second surface draws a {word} {word} stroke across {string}",
    async function (colourName, tool, elementId) {
        const id = await beginStroke(this, colourName, tool, elementId);
        await sendFromSurface(this, {name: "strokeEnd", id});
    }
);

When(
    "the second surface starts a {word} {word} stroke across {string} and does not finish it",
    async function (colourName, tool, elementId) {
        await beginStroke(this, colourName, tool, elementId);
    }
);

When("the second surface undoes", async function () {
    await sendFromSurface(this, {name: "drawingUndo"});
});

When("the second surface erases the {word} stroke", async function (colourName) {
    const id = this.strokeIds?.[colourName];
    assert.ok(id, `the second surface drew no ${colourName} stroke`);
    await sendFromSurface(this, {name: "strokeErase", id});
});

When("the second surface clears the drawings", async function () {
    await sendFromSurface(this, {name: "drawingClear"});
});

When("the second surface hides the drawings", async function () {
    await sendFromSurface(this, {name: "drawingVisible", visible: false});
});

When("the second surface shows the drawings", async function () {
    await sendFromSurface(this, {name: "drawingVisible", visible: true});
});

When("the second surface sends a pen stroke with the colour {string}", async function (colour) {
    const id = "stroke-malformed";
    const points = await pointsAcross(this.audience, "r1");
    await sendFromSurface(this, {
        name: "strokeBegin",
        id,
        tool: "pen",
        color: colour,
        width: WIDTH,
        points
    });
    await sendFromSurface(this, {name: "strokeEnd", id});
    // Let the audience window paint whatever it took, so a stroke it should have refused shows.
    await this.audience.evaluate(
        () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
});

Then("the audience window shows {int} stroke(s)", async function (count) {
    await expectStrokeCount(this.audience, count);
});

Then("the audience window shows no strokes", async function () {
    await expectStrokeCount(this.audience, 0);
});

Then("the audience window shows only the {word} stroke", async function (colourName) {
    const fill = computedColour(colourOf(colourName));
    await expect
        .poll(async () => {
            const {layer, strokes} = await shownStrokes(this.audience);
            return layer ? strokes.map(stroke => stroke.fill) : "no drawing layer";
        }, WAIT)
        .toEqual([fill]);
});

Then("the stroke in the audience window lies over {string}", async function (elementId) {
    // The camera has stopped, so the stroke and the element are read at the same place.
    await expect
        .poll(() => this.audience.evaluate(() => window.sozi.player.animator.running), WAIT)
        .toBe(false);
    await expect
        .poll(
            () =>
                this.audience.evaluate(
                    ([selector, id]) => {
                        const stroke = document.querySelector(`${selector} path`);
                        const element = document.getElementById(id);
                        if (!stroke || !element) {
                            return "no stroke or no element";
                        }
                        const s = stroke.getBoundingClientRect();
                        const e = element.getBoundingClientRect();
                        const cx = s.x + s.width / 2;
                        const cy = s.y + s.height / 2;
                        const inside = cx > e.left && cx < e.right && cy > e.top && cy < e.bottom;
                        // The stroke spans most of the element's width, at the element's scale.
                        const spans = s.width > e.width * 0.6 && s.width < e.width * 1.1;
                        return inside && spans ? "over" : "elsewhere";
                    },
                    [LAYER, elementId]
                ),
            WAIT
        )
        .toBe("over");
});

Then("the second surface's current-frame preview shows {int} stroke(s)", async function (count) {
    await expectStrokeCount(await currentPreviewDeck(this.secondSurface), count);
});

Then("the current-frame preview shows {int} stroke(s)", async function (count) {
    await expectStrokeCount(await currentPreviewDeck(this.presenter), count);
});

Then("the highlighter stroke is painted under the pen stroke", async function () {
    await expect
        .poll(
            () =>
                this.audience.evaluate(
                    ([selector, pen, highlighter]) => {
                        const fills = Array.from(
                            document.querySelectorAll(`${selector} path`),
                            path => getComputedStyle(path).fill
                        );
                        const under = fills.indexOf(highlighter);
                        const over = fills.indexOf(pen);
                        if (under < 0 || over < 0) {
                            return "the two strokes are not both drawn";
                        }
                        // Later in the tree is painted on top.
                        return under < over ? "under" : "over";
                    },
                    [LAYER, computedColour(COLOURS.red), computedColour(COLOURS.yellow)]
                ),
            WAIT
        )
        .toBe("under");
});
