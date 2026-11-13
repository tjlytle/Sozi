import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {strokeOutline} from "../../../src/js/player/strokeOutline.js";
import {Tools} from "../../../src/js/protocol/drawings.js";

/** A finished horizontal stroke along y = 0, from x = 0 to x = 200.
 *
 * @param {string} tool - `pen` or `highlighter`.
 * @param {(share: number) => number} pressure - The pressure along the stroke, from 0 to 1.
 * @returns {any} - The stroke.
 */
function lineStroke(tool, pressure) {
    const points = Array.from({length: 41}, (_, i) => [i * 5, 0, pressure(i / 40)]);
    return {id: "s1", tool, color: "#ff0000", width: 10, points, done: true};
}

/** The points of an outline's path, as `[x, y]` pairs.
 *
 * @param {string} d - The path.
 * @returns {number[][]} - Its points.
 */
function pathPoints(d) {
    const numbers = (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);
    return Array.from({length: numbers.length / 2}, (_, i) => numbers.slice(2 * i, 2 * i + 2));
}

/** How far a horizontal stroke's outline reaches from its line, at its widest.
 *
 * @param {string} d - The outline's path.
 * @returns {number} - The half width.
 */
function halfWidth(d) {
    return Math.max(...pathPoints(d).map(([, y]) => Math.abs(y)));
}

/** The half widths of a horizontal stroke's outline along its middle, away from its caps.
 *
 * @param {string} d - The outline's path.
 * @returns {number[]} - The distance of each point from the line.
 */
function middleHalfWidths(d) {
    return pathPoints(d)
        .filter(([x]) => x > 50 && x < 150)
        .map(([, y]) => Math.abs(y));
}

describe("strokeOutline", () => {
    test("is an SVG path that closes", () => {
        const d = strokeOutline(lineStroke(Tools.pen, () => 0.5));
        assert.match(d, /^M/);
        assert.match(d, /Z$/);
        assert.ok(pathPoints(d).length > 4);
    });

    test("rising pressure gives a wider pen outline than constant low pressure", () => {
        const low = strokeOutline(lineStroke(Tools.pen, () => 0.1));
        const rising = strokeOutline(lineStroke(Tools.pen, share => 0.1 + 0.9 * share));
        assert.ok(halfWidth(rising) > halfWidth(low) * 1.5, `${halfWidth(rising)}`);
    });

    test("constant pressure gives a constant width", () => {
        const widths = middleHalfWidths(strokeOutline(lineStroke(Tools.pen, () => 0.5)));
        assert.ok(widths.length > 4);
        const spread = Math.max(...widths) - Math.min(...widths);
        assert.ok(spread < 0.05 * Math.max(...widths), `spread ${spread}`);
    });

    test("the highlighter does not thin with pressure", () => {
        const low = strokeOutline(lineStroke(Tools.highlighter, () => 0.1));
        const high = strokeOutline(lineStroke(Tools.highlighter, () => 1));
        assert.ok(Math.abs(halfWidth(low) - halfWidth(high)) < 0.01);
    });

    test("a stroke with no point has an empty outline", () => {
        assert.equal(strokeOutline({...lineStroke(Tools.pen, () => 0.5), points: []}), "");
    });
});
