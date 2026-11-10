/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Show and hide elements of the author's SVG document.
 *
 * The author's elements often carry their own inline style (Inkscape writes
 * `style="display:inline"` on every layer), which outranks any class rule.
 * So Sozi hides them with an inline style too, and only through this module.
 *
 * @module
 */

/** Show or hide an element of the author's document, taking it out of the layout when hidden.
 *
 * @param {HTMLElement|SVGElement} element - An element of the author's SVG document.
 * @param {boolean} displayed - `true` to show the element, `false` to hide it.
 */
export function setDisplayed(element, displayed) {
    element.style.display = displayed ? "initial" : "none";
}

/** Show or hide an element of the author's document, keeping its place in the layout.
 *
 * @param {HTMLElement|SVGElement} element - An element of the author's SVG document.
 * @param {boolean} visible - `true` to show the element, `false` to hide it.
 */
export function setVisible(element, visible) {
    element.style.visibility = visible ? "visible" : "hidden";
}
