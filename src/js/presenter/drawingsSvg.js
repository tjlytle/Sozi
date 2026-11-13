/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The drawings as an SVG file: one Inkscape layer that lines up with the deck's own SVG.
 *
 * @module
 */

import {Tools} from "../protocol/drawings.js";
import {strokeOutline} from "../protocol/strokeOutline.js";

/** @typedef {import("../protocol/drawings.js").Drawings} Drawings */
/** @typedef {import("../protocol/canvas.js").Canvas} Canvas */

/** How see-through a highlighter path is. It must match `--sozi-drawing-highlighter-opacity` in
 * `src/templates/player.html`, which the audience window paints with; a scenario checks both.
 *
 * @readonly
 * @type {number}
 */
export const HIGHLIGHTER_OPACITY = 0.4;

/** The text an attribute's value is written with, escaped.
 *
 * @param {string | number} value - The value.
 * @returns {string} The escaped text.
 */
function escapeAttribute(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** An element's attributes, as text, each with a space before it; an empty value is left out.
 *
 * @param {Array<[string, string | number]>} attributes - Each name and value, in order.
 * @returns {string} The attributes.
 */
function attributesText(attributes) {
    return attributes
        .filter(([, value]) => value !== "")
        .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
        .join("");
}

/** The box around every point of some paths, as a viewBox.
 *
 * @param {string[]} paths - Paths whose numbers are `x,y` pairs, as `strokeOutline` gives.
 * @returns {string} The box as `x y width height`, empty when there is no point.
 */
function boundingViewBox(paths) {
    const numbers = paths.flatMap(d => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number));
    const xs = numbers.filter((_, i) => i % 2 === 0);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    if (xs.length === 0) {
        return "";
    }
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return [x, y, Math.max(...xs) - x, Math.max(...ys) - y].join(" ");
}

/**
 * The drawings as an SVG file, to open alone or paste in place over the deck's SVG.
 *
 * It holds one Inkscape layer, `Drawings`, with one filled path per stroke: the outline the
 * audience window draws, with the stroke's colour. The highlighter paths come first, see-through,
 * so they lie under the pen's, as on screen. Hidden drawings are saved too. The root takes the
 * source SVG's canvas, so each stroke sits on the artwork it marked; with no canvas, from a deck
 * built before it was recorded, the viewBox is the strokes' box and the root has no size.
 *
 * @param {Drawings} drawings - The drawings.
 * @param {?Canvas} canvas - The source SVG's canvas, null when the deck did not record it.
 * @returns {string} The SVG text.
 */
export function drawingsSvg({strokes}, canvas) {
    const ordered = [Tools.highlighter, Tools.pen].flatMap(tool =>
        strokes.filter(stroke => stroke.tool === tool)
    );
    const paths = ordered
        .map(stroke => ({stroke, d: strokeOutline(stroke)}))
        .filter(({d}) => d !== "");
    const pathsText = paths.map(({stroke, d}) => {
        const opacity = stroke.tool === Tools.highlighter ? HIGHLIGHTER_OPACITY : "";
        return `    <path${attributesText([
            ["d", d],
            ["fill", stroke.color],
            ["fill-opacity", opacity]
        ])}/>\n`;
    });
    const root = attributesText([
        ["xmlns", "http://www.w3.org/2000/svg"],
        ["xmlns:inkscape", "http://www.inkscape.org/namespaces/inkscape"],
        ["viewBox", canvas ? canvas.viewBox.join(" ") : boundingViewBox(paths.map(({d}) => d))],
        ["width", canvas ? canvas.width : ""],
        ["height", canvas ? canvas.height : ""]
    ]);
    const layer = attributesText([
        ["inkscape:groupmode", "layer"],
        ["inkscape:label", "Drawings"]
    ]);
    return (
        `<?xml version="1.0" encoding="UTF-8"?>\n<svg${root}>\n  <g${layer}>\n` +
        `${pathsText.join("")}  </g>\n</svg>\n`
    );
}

/**
 * The name the drawings of a deck are saved under; never the deck's own SVG.
 *
 * @param {string} deckId - The deck's file name without `.sozi.html`.
 * @returns {string} The file name.
 */
export function drawingsFileName(deckId) {
    return `${deckId}-drawings.svg`;
}
