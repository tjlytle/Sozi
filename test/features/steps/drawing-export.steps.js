/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The export of the drawings (#522): the presenter downloads them as one SVG file. The world
// records every download; the steps read the last one, and parse it, and the deck's source SVG,
// in a blank page of the scenario, so a box is measured the way Inkscape would measure it. The
// drawing is done by the steps of preview-drawing.steps.js.

import {Then} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {expect} from "playwright/test";
import {builtDeck, deckFileHashes} from "../support/decks.js";
import {LAYER, WAIT, contentOf} from "../support/panels.js";

/** How far outside an element a saved stroke's box may reach, in canvas units: its width. */
const STROKE_PAD = 20;

/** The Inkscape namespace, which marks a group as a layer. */
const INKSCAPE = "http://www.inkscape.org/namespaces/inkscape";

/** The file the presenter page downloaded last, once it has finished downloading.
 *
 * @param {any} world - The scenario's world.
 * @returns {Promise<{name: string, text: string}>} - Its suggested name and its text.
 */
async function savedFile(world) {
    await expect.poll(() => world.downloads.length, WAIT).toBeGreaterThan(0);
    const download = world.downloads.at(-1);
    const file = await download.path();
    return {name: download.suggestedFilename(), text: fs.readFileSync(file, "utf8")};
}

/** @typedef {{x: number, y: number, width: number, height: number}} Box */

// The next three functions run in a browser page, through `evaluate` and `evaluateAll`, so each
// one stands alone: it reaches nothing of this module.

/** Put the root of an SVG file into a blank page's body, where it is drawn and can be measured.
 *
 * @param {string} svg - The SVG text.
 */
function mountSvg(svg) {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    document.body.append(document.importNode(parsed.documentElement, true));
}

/** The box of each element of a mounted SVG file, in the root's user units: the `viewBox`'s.
 *
 * @param {Element[]} elements - Elements of the file.
 * @returns {Box[]} - The box of each.
 */
function boxesInRoot(elements) {
    // Cast: the mounted file's root is an SVG element, and the elements are drawn in it.
    const root = /** @type {SVGSVGElement} */ (document.querySelector("body > svg"));
    return elements.map(element => {
        const graphic = /** @type {SVGGraphicsElement} */ (/** @type {unknown} */ (element));
        const toRoot = /** @type {DOMMatrix} */ (root.getScreenCTM())
            .inverse()
            .multiply(/** @type {DOMMatrix} */ (graphic.getScreenCTM()));
        const b = graphic.getBBox();
        const corners = [
            [b.x, b.y],
            [b.x + b.width, b.y],
            [b.x, b.y + b.height],
            [b.x + b.width, b.y + b.height]
        ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(toRoot));
        const xs = corners.map(p => p.x);
        const ys = corners.map(p => p.y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return {x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y};
    });
}

/** The opacity each path is painted with: its `fill-opacity` times the opacity of every element
 * it is in, so a value on the path and one on its group read the same.
 *
 * @param {Element[]} paths - Paths in a page.
 * @returns {number[]} - The opacity of each.
 */
function paintedOpacities(paths) {
    return paths.map(path => {
        let opacity = Number(getComputedStyle(path).fillOpacity);
        for (let e = path.parentElement; e; e = e.parentElement) {
            opacity *= Number(getComputedStyle(e).opacity);
        }
        return opacity;
    });
}

/** What an SVG file holds, read in a blank page of the scenario.
 *
 * @param {any} world - The scenario's world.
 * @param {string} text - The SVG text.
 * @param {string} [elementId] - An element whose box to read too.
 * @returns {Promise<{root: string, viewBox: ?string, width: ?string, height: ?string, layers: number, paths: {fill: string, opacity: number, box: Box}[], element: ?Box}>}
 *     - The root's name and size, its Inkscape layers, its paths and the element's box.
 */
async function readSvg(world, text, elementId) {
    const page = await world.context.newPage();
    try {
        await page.evaluate(mountSvg, text);
        const root = await page.locator("body > *").evaluate(
            (r, inkscape) => ({
                root: r.localName,
                viewBox: r.getAttribute("viewBox"),
                width: r.getAttribute("width"),
                height: r.getAttribute("height"),
                layers: Array.from(r.querySelectorAll("g")).filter(
                    g => g.getAttributeNS(inkscape, "groupmode") === "layer"
                ).length
            }),
            INKSCAPE
        );
        const paths = page.locator("body > * path");
        const fills = await paths.evaluateAll(all => all.map(p => getComputedStyle(p).fill));
        const opacities = await paths.evaluateAll(paintedOpacities);
        const boxes = await paths.evaluateAll(boxesInRoot);
        const [element = null] = elementId
            ? await page.locator(`[id="${elementId}"]`).evaluateAll(boxesInRoot)
            : [];
        return {
            ...root,
            paths: fills.map((fill, i) => ({fill, opacity: opacities[i], box: boxes[i]})),
            element
        };
    } finally {
        await page.close();
    }
}

Then("the file {string} is saved", async function (name) {
    const {name: saved} = await savedFile(this);
    assert.equal(saved, name);
});

Then("the saved file holds {int} path(s) in {int} layer(s)", async function (paths, layers) {
    const svg = await readSvg(this, (await savedFile(this)).text);
    assert.equal(svg.root, "svg", "the saved file is an SVG");
    assert.equal(svg.paths.length, paths, "the paths in the saved file");
    assert.equal(svg.layers, layers, "the Inkscape layers in the saved file");
});

Then(
    "the saved file has the viewBox {string}, the width {string} and the height {string}",
    async function (viewBox, width, height) {
        const svg = await readSvg(this, (await savedFile(this)).text);
        assert.deepEqual(
            {viewBox: svg.viewBox, width: svg.width, height: svg.height},
            {viewBox, width, height}
        );
    }
);

Then("the saved path lies over {string} of {string}", async function (elementId, source) {
    const deck = builtDeck(this.fixture);
    assert.equal(path.basename(deck.svg), source, "the scenario's deck");
    const saved = await readSvg(this, (await savedFile(this)).text);
    const {element} = await readSvg(this, fs.readFileSync(deck.svg, "utf8"), elementId);
    assert.ok(element, `${source} has no element "${elementId}"`);
    assert.equal(saved.paths.length, 1, "the saved file holds one path");
    const s = saved.paths[0].box;
    const inside =
        s.x >= element.x - STROKE_PAD &&
        s.y >= element.y - STROKE_PAD &&
        s.x + s.width <= element.x + element.width + STROKE_PAD &&
        s.y + s.height <= element.y + element.height + STROKE_PAD;
    // The drag ran across most of the element, so the stroke spans most of its width.
    const spans = s.width > element.width * 0.6;
    assert.ok(
        inside && spans,
        `the saved path's box ${JSON.stringify(s)} is not over ${elementId} ${JSON.stringify(element)}`
    );
});

Then(
    "the saved path has the fill and opacity of the highlighter stroke in the audience window",
    async function () {
        const highlighters = this.audience.locator(`${LAYER} .sozi-drawing__highlighter path`);
        await expect(highlighters).toHaveCount(1, WAIT);
        const shown = {
            fill: await highlighters.evaluate(path => getComputedStyle(path).fill),
            opacity: (await highlighters.evaluateAll(paintedOpacities))[0]
        };
        const saved = await readSvg(this, (await savedFile(this)).text);
        assert.equal(saved.paths.length, 1, "the saved file holds one path");
        assert.equal(saved.paths[0].fill, shown.fill, "the saved path's fill");
        assert.ok(shown.opacity < 1, "the highlighter in the audience window is see-through");
        assert.ok(
            Math.abs(saved.paths[0].opacity - shown.opacity) < 0.01,
            `the saved path's opacity ${saved.paths[0].opacity} is not ${shown.opacity}`
        );
    }
);

Then("the {string} button in the {string} panel is disabled", async function (name, title) {
    const button = contentOf(this.presenter, title).getByRole("button", {name, exact: true});
    await expect(button).toBeDisabled(WAIT);
});

Then("the {string} button in the {string} panel is enabled", async function (name, title) {
    const button = contentOf(this.presenter, title).getByRole("button", {name, exact: true});
    await expect(button).toBeEnabled(WAIT);
});

// Cucumber counts a step's declared parameters, so each of the three is named: `...kinds` has none.
Then("the deck's {string}, {string} and {string} files are unchanged", async function (a, b, c) {
    // `deckFileHashes` reads these three, as `buildDeck` did.
    assert.deepEqual([a, b, c], [".svg", ".sozi.json", ".sozi.html"], "the deck's own files");
    // The export has finished before the files are read, so a write it made would show.
    await savedFile(this);
    const deck = builtDeck(this.fixture);
    assert.deepEqual(deckFileHashes(deck.svg), deck.files);
});
