/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The messages a surface and its preview deck exchange about thumbnails.
 *
 * `readMessage` in `messages.js` reads them too.
 *
 * @module
 */

/** @typedef {{name: "thumbnailRequest", index: number, width: number}} ThumbnailRequestMessage */
/** @typedef {{name: "thumbnail", index: number, url: string}} ThumbnailMessage */

/** How a thumbnail's URL starts.
 *
 * @readonly
 * @default
 * @type {string}
 */
const URL_START = "data:image/jpeg;base64,";

/**
 * Build a `thumbnailRequest`: a preview deck is to draw a frame for a surface.
 *
 * @param {number} index - The frame's position, from 0.
 * @param {number} width - The thumbnail's width, in pixels.
 * @returns {ThumbnailRequestMessage} The message.
 */
export function thumbnailRequestMessage(index, width) {
    return {name: "thumbnailRequest", index, width};
}

/**
 * Build a `thumbnail`: what a preview deck drew.
 *
 * @param {number} index - The frame's position, from 0.
 * @param {string} url - A JPEG `data:` URL, empty when rendering failed.
 * @returns {ThumbnailMessage} The message.
 */
export function thumbnailMessage(index, url) {
    return {name: "thumbnail", index, url};
}

/**
 * Is it a frame's position?
 *
 * @param {any} v - The value.
 * @returns {boolean} True for 0, 1, 2…
 */
function isIndex(v) {
    return Number.isInteger(v) && v >= 0;
}

/**
 * Read a received `thumbnailRequest`.
 *
 * @param {any} data - The message.
 * @returns {ThumbnailRequestMessage | null} The message, or null without an index and a
 *   positive integer width.
 */
export function readThumbnailRequest({index, width}) {
    return isIndex(index) && Number.isInteger(width) && width > 0
        ? thumbnailRequestMessage(index, width)
        : null;
}

/**
 * Read a received `thumbnail`.
 *
 * A message cannot point an `<img>` anywhere: its URL is empty or a JPEG `data:` URL.
 *
 * @param {any} data - The message.
 * @returns {ThumbnailMessage | null} The message, or null if a field is malformed.
 */
export function readThumbnail({index, url}) {
    const validUrl = url === "" || (typeof url === "string" && url.startsWith(URL_START));
    return isIndex(index) && validUrl ? thumbnailMessage(index, url) : null;
}
