/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The message names the display understood before the protocol, mapped onto it.
 *
 * Kept for one release so that pages written against the old names still drive a deck:
 * remove this module, and the `loaded` announcement, in the release after 24.11.
 *
 * @module
 */

import {
    Roles,
    helloMessage,
    blankMessage,
    jumpToFrameMessage,
    nextMessage,
    previousMessage,
    previewMessage,
    followLinkMessage
} from "./messages.js";

/** @typedef {import("./messages.js").Message} Message */

/**
 * What the display knows that an old name needs: First, Last and toggle resolve against it.
 *
 * @typedef {object} LegacyState
 * @property {number} frameCount - How many frames the deck has.
 * @property {boolean} blank - Is the blank screen shown?
 * @property {string[]} frameIds - The id of each frame, in order.
 */

/**
 * The frame index an old `jumpToFrame` or `moveToFrame` gave as its first argument.
 *
 * The old player took an index or a frame id there (`Player.findFrame`); an id resolves
 * to its index.
 *
 * @param {any} data - The old message.
 * @param {LegacyState} state - What the display knows now.
 * @returns {number | null} The index, or null when the argument names no frame.
 */
function argIndex(data, state) {
    const frame = Array.isArray(data.args) ? data.args[0] : undefined;
    if (typeof frame === "string") {
        const index = state.frameIds.indexOf(frame);
        return index >= 0 ? index : null;
    }
    return Number.isInteger(frame) && frame >= 0 ? frame : null;
}

/** One mapping per old name: the explicit table `fromLegacy` dispatches from (2.5).
 *
 * @readonly
 * @type {Readonly<Record<string, (data: any, state: LegacyState) => Message | null>>}
 */
const LEGACY = Object.freeze({
    notifyOnFrameChange: () => helloMessage(Roles.surface),
    jumpToFrame: (data, state) => {
        const index = argIndex(data, state);
        return index === null ? null : jumpToFrameMessage(index, false);
    },
    moveToFrame: (data, state) => {
        const index = argIndex(data, state);
        return index === null ? null : jumpToFrameMessage(index, true);
    },
    moveToNext: () => nextMessage(true),
    jumpToNext: () => nextMessage(false),
    moveToPrevious: () => previousMessage(true),
    jumpToPrevious: () => previousMessage(false),
    moveToFirst: () => jumpToFrameMessage(0, true),
    jumpToFirst: () => jumpToFrameMessage(0, false),
    moveToLast: (data, state) => jumpToFrameMessage(Math.max(state.frameCount - 1, 0), true),
    jumpToLast: (data, state) => jumpToFrameMessage(Math.max(state.frameCount - 1, 0), false),
    enableBlankScreen: () => blankMessage(true),
    toggleBlankScreen: (data, state) => blankMessage(!state.blank),
    setPresenterMode: data => previewMessage(Boolean(data.isCurrent)),
    click: data =>
        typeof data.id === "string" && data.id.length > 0 ? followLinkMessage(data.id) : null
});

/**
 * Map an old message onto the protocol.
 *
 * `loaded` maps to nothing: the display sends it and never needs to act on it.
 *
 * @param {any} data - The data of a message event.
 * @param {LegacyState} state - What the display knows now.
 * @returns {Message | null} The protocol message, or null if the data is no old message.
 */
export function fromLegacy(data, state) {
    if (data === null || typeof data !== "object" || !Object.hasOwn(LEGACY, data.name)) {
        return null;
    }
    return LEGACY[data.name](data, state);
}

/**
 * The old `loaded` announcement, which pages written before the protocol wait for.
 *
 * @param {number} frameCount - How many frames the deck has.
 * @returns {{name: "loaded", length: number}} The message.
 */
export function legacyLoadedMessage(frameCount) {
    return {name: "loaded", length: frameCount};
}
