/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** What the Frames panel computes: which frames a filter keeps, and which to render next.
 *
 * @module
 */

/** @typedef {import("../protocol/messages.js").FrameInfo} FrameInfo */

/** What a tile's button is found by.
 *
 * @readonly
 * @default
 * @type {string}
 */
const TILE_SELECTOR = "button.sozi-frame-picker__tile";

/**
 * The frame of the tile an event happened on.
 *
 * @param {any} target - The event's target, or null.
 * @returns {?number} The frame's position, null outside the tiles.
 */
export function frameOfTarget(target) {
    const tile = target ? target.closest(TILE_SELECTOR) : null;
    return tile ? Number(tile.dataset.index) : null;
}

/**
 * The frames whose title holds a text, ignoring case and the spaces around the text.
 *
 * @param {FrameInfo[]} frames - The frames, in deck order.
 * @param {string} query - The text; an empty one keeps every frame.
 * @returns {FrameInfo[]} The frames kept, in deck order.
 */
export function matchFrames(frames, query) {
    const text = query.trim().toLowerCase();
    return frames.filter(frame => frame.title.toLowerCase().includes(text));
}

/**
 * The frame to render next: a visible one if any is missing, or else the first missing.
 *
 * @param {number[]} missing - The frames with no thumbnail, in deck order.
 * @param {number[]} visible - The frames on screen.
 * @returns {?number} The frame's position, null when nothing is missing.
 */
export function nextToRender(missing, visible) {
    const first = missing.find(index => visible.includes(index));
    if (first !== undefined) {
        return first;
    }
    return missing.length ? missing[0] : null;
}
