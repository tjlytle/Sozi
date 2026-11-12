/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The outline of a stroke, as the path the drawing layer fills.
 *
 * @module
 */

import {getStroke} from "perfect-freehand";
import {Tools} from "../protocol/drawings.js";

/** @typedef {import("../protocol/drawings.js").Stroke} Stroke */

/** How much each tool's width follows the pressure: the pen swells and thins, the highlighter
 * keeps its width.
 *
 * @readonly
 * @type {Readonly<Record<string, number>>}
 */
const THINNING = Object.freeze({[Tools.pen]: 0.6, [Tools.highlighter]: 0});

/**
 * A number for a path, short enough to keep the path small.
 *
 * @param {number} n - The number.
 * @returns {string} It with at most two decimals.
 */
function short(n) {
    return String(Math.round(n * 100) / 100);
}

/**
 * The outline of a stroke, as an SVG path `d` in the stroke's canvas units.
 *
 * The width follows each point's pressure, smoothed; a constant pressure, as a mouse or a
 * finger gives, draws a constant width. The path runs through the midpoints of the outline's
 * points with each point as the control of a quadratic curve, so it has no corners.
 *
 * @param {Stroke} stroke - The stroke.
 * @returns {string} The path, empty for a stroke with no point.
 */
export function strokeOutline({tool, width, points, done}) {
    const outline = getStroke(points, {
        size: width,
        thinning: THINNING[tool],
        smoothing: 0.5,
        streamline: 0.5,
        simulatePressure: false,
        last: done
    });
    if (outline.length === 0) {
        return "";
    }
    const curves = outline.map(([x, y], i) => {
        const [nx, ny] = outline[(i + 1) % outline.length];
        return `${short(x)},${short(y)} ${short((x + nx) / 2)},${short((y + ny) / 2)}`;
    });
    const [x0, y0] = outline[0];
    return `M${short(x0)},${short(y0)} Q${curves.join(" ")} Z`;
}
