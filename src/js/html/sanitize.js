/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The one place HTML from data is parsed (standard 2.6): everything passes through DOMPurify.

import DOMPurify from "dompurify";

/** Replace the children of an element with sanitized HTML.
 *
 * Scripts, event handler attributes and `javascript:` URLs are removed;
 * formatting (bold, headings, lists, links, styles) is kept.
 *
 * @param {Element} element - The element whose children are replaced.
 * @param {string} html - The HTML to show, from data.
 */
export function setSanitizedHTML(element, html) {
    // Cast: an element in a page always has a window.
    const purify = DOMPurify(
        /** @type {Window & typeof globalThis} */ (element.ownerDocument.defaultView)
    );
    element.replaceChildren(purify.sanitize(html, {RETURN_DOM_FRAGMENT: true}));
}

/** Is there nothing to show in this HTML?
 *
 * An empty paragraph (`<p><br></p>`, as an editor's field leaves it) is blank; an image,
 * a table or a rule is not, even with no text in it.
 *
 * @param {string} html - The HTML, from data.
 * @param {Document} document - The document to parse it in.
 * @returns {boolean} - True when it shows no text and nothing else.
 */
export function isBlankHTML(html, document) {
    const holder = document.createElement("div");
    setSanitizedHTML(holder, html);
    return (
        !(holder.textContent || "").trim() &&
        !holder.querySelector("img, svg, video, audio, table, hr, input")
    );
}

/** Return the HTML content of an element.
 *
 * @param {Element} element - The element to read.
 * @returns {string} - The HTML of the element's children.
 */
export function serializeHTML(element) {
    return element.innerHTML;
}
