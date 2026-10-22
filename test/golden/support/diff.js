/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {createRequire} from "node:module";

const {decodePng} = createRequire(import.meta.url)("../../cli/helpers.js");

/** The mean absolute difference over the RGB channels of two decoded images of the same size.
 *
 * @param {{width: number, height: number, pixel: Function}} a - A decoded image.
 * @param {{width: number, height: number, pixel: Function}} b - A decoded image.
 * @returns {number} - 0 for equal images, 1 for black against white.
 */
export function meanAbsDiffDecoded(a, b) {
    if (a.width !== b.width || a.height !== b.height) {
        throw new Error(`size mismatch: ${a.width}x${a.height} against ${b.width}x${b.height}`);
    }
    let sum = 0;
    for (let y = 0; y < a.height; y++) {
        for (let x = 0; x < a.width; x++) {
            const pa = a.pixel(x, y);
            const pb = b.pixel(x, y);
            sum += Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]);
        }
    }
    return sum / (a.width * a.height * 3 * 255);
}

/** The mean absolute difference over the RGB channels of two PNG files of the same size.
 *
 * @param {Buffer} pngA - The content of a PNG file.
 * @param {Buffer} pngB - The content of a PNG file.
 * @returns {number} - 0 for equal images, 1 for black against white.
 */
export function meanAbsDiff(pngA, pngB) {
    return meanAbsDiffDecoded(decodePng(pngA), decodePng(pngB));
}
