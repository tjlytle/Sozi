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

/** What an SVG file holds, read in a blank page of the scenario.
 *
 * Each path's box is in the root's user units, the `viewBox`'s; its opacity is its
 * `fill-opacity` times the opacity of every group it is in.
 *
 * @param {any} world - The scenario's world.
 * @param {string} text - The SVG text.
 * @param {string} [elementId] - An element whose box to read too.
 * @returns {Promise<{root: string, viewBox: ?string, width: ?string, height: ?string, layers: number, paths: {fill: string, opacity: number, box: Box}[], element: ?Box}>}
 *     - What the file holds.
 */
async function readSvg(world, text, elementId) {
    const page = await world.context.newPage();
    try {
        return await page.evaluate(
            ([svg, id, inkscape]) => {
                const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
                // Cast: an SVG parse's root is an SVG element, which DOMParser's type does not say.
                const root = /** @type {SVGSVGElement} */ (
                    /** @type {unknown} */ (document.importNode(parsed.documentElement, true))
                );
                document.body.append(root);
                /**
                 * @param {SVGGraphicsElement} element - An element of the file.
                 * @returns {{x: number, y: number, width: number, height: number}} - Its box.
                 */
                const boxOf = element => {
                    const toRoot = /** @type {DOMMatrix} */ (root.getScreenCTM())
                        .inverse()
                        .multiply(/** @type {DOMMatrix} */ (element.getScreenCTM()));
                    const b = element.getBBox();
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
                };
                /**
                 * @param {Element} path - A path of the file.
                 * @returns {number} - The opacity it is painted with.
                 */
                const opacityOf = path => {
                    let opacity = Number(getComputedStyle(path).fillOpacity);
                    for (
                        let e = /** @type {?Element} */ (path.parentElement);
                        e && e !== root;
                        e = e.parentElement
                    ) {
                        opacity *= Number(getComputedStyle(e).opacity);
                    }
                    return opacity * Number(getComputedStyle(root).opacity);
                };
                const element = id ? document.getElementById(id) : null;
                return {
                    root: root.localName,
                    viewBox: root.getAttribute("viewBox"),
                    width: root.getAttribute("width"),
                    height: root.getAttribute("height"),
                    layers: Array.from(root.querySelectorAll("g")).filter(
                        g => g.getAttributeNS(inkscape, "groupmode") === "layer"
                    ).length,
                    paths: Array.from(root.querySelectorAll("path"), path => ({
                        fill: getComputedStyle(path).fill,
                        opacity: opacityOf(path),
                        box: boxOf(
                            /** @type {SVGGraphicsElement} */ (/** @type {unknown} */ (path))
                        )
                    })),
                    element: element
                        ? boxOf(
                              /** @type {SVGGraphicsElement} */ (/** @type {unknown} */ (element))
                          )
                        : null
                };
            },
            /** @type {[string, string, string]} */ ([text, elementId ?? "", INKSCAPE])
        );
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
        const shown = await this.audience.evaluate(selector => {
            const path = document.querySelector(`${selector} .sozi-drawing__highlighter path`);
            if (!path) {
                return null;
            }
            let opacity = Number(getComputedStyle(path).fillOpacity);
            for (let e = path.parentElement; e && !e.matches(selector); e = e.parentElement) {
                opacity *= Number(getComputedStyle(e).opacity);
            }
            return {fill: getComputedStyle(path).fill, opacity};
        }, LAYER);
        assert.ok(shown, "the audience window shows a highlighter stroke");
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

Then("the deck's {string}, {string} and {string} files are unchanged", async function (...kinds) {
    // `deckFileHashes` reads these three, as `buildDeck` did.
    assert.deepEqual(kinds, [".svg", ".sozi.json", ".sozi.html"], "the deck's own files");
    // The export has finished before the files are read, so a write it made would show.
    await savedFile(this);
    const deck = builtDeck(this.fixture);
    assert.deepEqual(deckFileHashes(deck.svg), deck.files);
});
