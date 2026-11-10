/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Where a link in the notes goes: a frame of the deck, a missing frame, or elsewhere.
 *
 * @module
 */

/** @typedef {import("../protocol/messages.js").FrameInfo} FrameInfo */

/**
 * Where a link goes.
 *
 * @typedef {{kind: "frame", index: number}
 *     | {kind: "broken", fragment: string}
 *     | {kind: "external"}} LinkTarget
 */

/** Read a link's `href` as the deck's player reads its address: a frame id, then a number.
 *
 * Only an `href` that starts with `#` names a frame. A number counts from 1 and is digits only.
 *
 * @param {string} href - The link's `href` attribute, as written.
 * @param {FrameInfo[]} frames - The deck's frames, in deck order.
 * @returns {LinkTarget} Where the link goes.
 */
export function linkTarget(href, frames) {
    if (!href.startsWith("#")) {
        return {kind: "external"};
    }
    const fragment = decodeFragment(href.slice(1));
    const byId = frames.find(({id}) => id === fragment);
    if (byId) {
        return {kind: "frame", index: byId.index};
    }
    if (/^\d+$/.test(fragment)) {
        const number = Number(fragment);
        if (number >= 1 && number <= frames.length) {
            return {kind: "frame", index: frames[number - 1].index};
        }
    }
    return {kind: "broken", fragment};
}

/** Decode a fragment's percent escapes; a bad escape leaves it as written.
 *
 * @param {string} fragment - The fragment, without its `#`.
 * @returns {string} The decoded fragment.
 */
function decodeFragment(fragment) {
    try {
        return decodeURIComponent(fragment);
    } catch {
        return fragment;
    }
}
