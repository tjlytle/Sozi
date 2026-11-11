/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Turn an Inkscape page colour and opacity into a CSS background colour.
 *
 * @module
 */

/** Three- or six-digit hex, with or without a leading `#`. */
const HEX_COLOR = /^#?(?:([a-f\d])([a-f\d])([a-f\d])|([a-f\d]{2})([a-f\d]{2})([a-f\d]{2}))$/i;

/** Compute the page background from Inkscape's `pagecolor` and `inkscape:pageopacity`.
 *
 * @param {string} pageColor - The `pagecolor` attribute of `sodipodi:namedview`.
 * @param {string} pageOpacity - The `inkscape:pageopacity` attribute.
 * @returns {string|null} - An `rgba(r, g, b, a)` colour, or `null` when the page colour is not
 *     three- or six-digit hex. An opacity that is not a number counts as 0; one outside 0 to 1 is
 *     clamped.
 */
export function pageBackground(pageColor, pageOpacity) {
    const match = HEX_COLOR.exec(pageColor);
    if (!match) {
        return null;
    }
    const channels = match[1] ? match.slice(1, 4).map(digit => digit + digit) : match.slice(4, 7);
    const [red, green, blue] = channels.map(hex => parseInt(hex, 16));
    const opacity = Number(pageOpacity);
    const alpha = Number.isFinite(opacity) ? Math.min(Math.max(opacity, 0), 1) : 0;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
