/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The presentation keys: what each one sends the display.
 *
 * @module
 */

import {
    blankMessage,
    jumpToFrameMessage,
    nextMessage,
    previousMessage
} from "../protocol/messages.js";

/** @typedef {import("../protocol/messages.js").KeyModifiers} KeyModifiers */
/** @typedef {import("../protocol/messages.js").Message} Message */

/**
 * The message a presentation key sends the display.
 *
 * Shift moves without a transition. A key held with Alt, Ctrl or Meta is the browser's.
 *
 * @param {string} key - The key, as `KeyboardEvent.key` names it.
 * @param {KeyModifiers} modifiers - The modifier keys held down with it.
 * @param {{frameCount: number, blank: boolean}} display - The display as it last reported itself.
 * @returns {?Message} The message, or null for any other key.
 */
export function messageForKey(key, {shift, alt, ctrl, meta}, display) {
    if (alt || ctrl || meta) {
        return null;
    }
    switch (key) {
        case "Home":
            return jumpToFrameMessage(0, !shift);
        case "End":
            return jumpToFrameMessage(Math.max(display.frameCount - 1, 0), !shift);
        case "ArrowUp":
        case "PageUp":
        case "ArrowLeft":
            return previousMessage(!shift);
        case "ArrowDown":
        case "PageDown":
        case "ArrowRight":
        case "Enter":
        case " ":
            return nextMessage(!shift);
        case ".":
            return blankMessage(!display.blank);
        default:
            return null;
    }
}
