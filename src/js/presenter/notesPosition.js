/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** What the Notes panel computes: the section covering a frame, the font size, the file's address.
 *
 * @module
 */

/** The notes' font size until the speaker changes it, in pixels.
 *
 * @readonly
 * @default
 * @type {number}
 */
export const DEFAULT_FONT_SIZE = 16;

/** The smallest font size, in pixels.
 *
 * @readonly
 * @default
 * @type {number}
 */
const MIN_FONT_SIZE = 12;

/** The largest font size, in pixels.
 *
 * @readonly
 * @default
 * @type {number}
 */
const MAX_FONT_SIZE = 32;

/** The section that covers a frame: its own, or the nearest one before it.
 *
 * @template {{index: number}} S
 * @param {S[]} sections - The sections, in deck order.
 * @param {number} index - The frame's position, from 0.
 * @returns {?S} The section, or null for a frame before every section.
 */
export function coveringSection(sections, index) {
    const covering = sections.filter(section => section.index <= index);
    return covering.length ? covering[covering.length - 1] : null;
}

/** Keep a font size in its bounds.
 *
 * @param {number} size - The size, in pixels.
 * @returns {number} The nearest size allowed.
 */
function clampFontSize(size) {
    return Math.min(Math.max(size, MIN_FONT_SIZE), MAX_FONT_SIZE);
}

/** Read a stored font size.
 *
 * @param {?string} text - What storage holds, null when it holds nothing.
 * @returns {number} The size in its bounds, or the default for text that is not a size.
 */
export function readFontSize(text) {
    return /^\d+$/.test(text || "") ? clampFontSize(Number(text)) : DEFAULT_FONT_SIZE;
}

/** The font size after a press of A− or A+.
 *
 * @param {number} size - The size now, in pixels.
 * @param {number} step - How much to change it by.
 * @returns {number} The new size, in its bounds.
 */
export function nextFontSize(size, step) {
    return clampFontSize(size + step);
}

/** Where a published notes file sits for a deck: beside it, under the deck's name.
 *
 * @param {string} deckHref - The address of the deck's page.
 * @returns {?string} The file's address; null unless the deck is on `http:` or `https:`,
 *     since a page on `file:` cannot read a sibling file.
 */
export function notesUrl(deckHref) {
    if (!/^https?:/i.test(deckHref)) {
        return null;
    }
    const url = new URL(deckHref);
    if (!url.pathname.endsWith(".sozi.html")) {
        return null;
    }
    url.pathname = url.pathname.replace(/\.sozi\.html$/, ".notes.md");
    url.search = "";
    url.hash = "";
    return url.href;
}
