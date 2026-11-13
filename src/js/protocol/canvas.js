/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The canvas of the deck's source SVG: its `viewBox`, `width` and `height`, which the built page
 * no longer has, and which a display's `hello` carries so a surface can save the drawings in the
 * source's own coordinates.
 *
 * @module
 */

/**
 * The canvas of a source SVG. `width` and `height` are empty when the source has none usable.
 *
 * @typedef {object} Canvas
 * @property {number[]} viewBox - `[x, y, width, height]`, in user units, the size above 0.
 * @property {string} width - The root's width as written, as `800` or `210mm`, or empty.
 * @property {string} height - The root's height as written, or empty.
 */

/** A length an SVG root's `width` or `height` may be saved with: a number and an absolute unit.
 *
 * @readonly
 * @type {RegExp}
 */
const LENGTH = /^\d+(\.\d+)?(px|mm|cm|in|pt|pc)?$/;

/** A length in pixels, which is also a size in user units.
 *
 * @readonly
 * @type {RegExp}
 */
const PIXELS = /^\d+(\.\d+)?(px)?$/;

/**
 * Is it a viewBox: four finite numbers, the last two above 0?
 *
 * @param {any} v - The value.
 * @returns {boolean} True for a viewBox.
 */
function isViewBox(v) {
    return (
        Array.isArray(v) &&
        v.length === 4 &&
        v.every(n => typeof n === "number" && Number.isFinite(n)) &&
        v[2] > 0 &&
        v[3] > 0
    );
}

/**
 * Read a length field: absent and empty read as empty.
 *
 * @param {any} v - The field.
 * @returns {?string} The length, or null if it is not one.
 */
function readLength(v) {
    if (v === undefined || v === "") {
        return "";
    }
    return typeof v === "string" && LENGTH.test(v) ? v : null;
}

/**
 * Read a received canvas.
 *
 * @param {any} data - The fields of a canvas.
 * @returns {Canvas | null} The canvas, or null if a field is malformed.
 */
export function readCanvas(data) {
    if (data === null || typeof data !== "object" || !isViewBox(data.viewBox)) {
        return null;
    }
    const width = readLength(data.width);
    const height = readLength(data.height);
    return width === null || height === null ? null : {viewBox: [...data.viewBox], width, height};
}

/**
 * The canvas of an SVG root, from its attributes as written.
 *
 * A width or a height that is not an absolute length is left out. A root with no `viewBox` takes
 * `0 0 width height` when both are in pixels, the only unit that is also a user unit.
 *
 * @param {?string} viewBox - The `viewBox` attribute, null when there is none.
 * @param {?string} width - The `width` attribute, null when there is none.
 * @param {?string} height - The `height` attribute, null when there is none.
 * @returns {Canvas | null} The canvas, or null if the root gives none.
 */
export function canvasOf(viewBox, width, height) {
    const w = width !== null && LENGTH.test(width) ? width : "";
    const h = height !== null && LENGTH.test(height) ? height : "";
    if (viewBox !== null) {
        return readCanvas({
            viewBox: viewBox
                .trim()
                .split(/[\s,]+/)
                .map(Number),
            width: w,
            height: h
        });
    }
    if (PIXELS.test(w) && PIXELS.test(h)) {
        return readCanvas({viewBox: [0, 0, parseFloat(w), parseFloat(h)], width: w, height: h});
    }
    return null;
}
