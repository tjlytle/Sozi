/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The messages a display and its surfaces exchange: names, builders and one reader.
 *
 * docs/presenter-protocol.md describes each one. The `viewport` message lives in
 * `viewport.js`; `readMessage` reads it too.
 *
 * @module
 */

import {readViewport} from "./viewport.js";

/** @typedef {import("./viewport.js").Viewport} Viewport */
/** @typedef {import("./viewport.js").ViewportMessage} ViewportMessage */

/** The name of every message, the value of its `name` field.
 *
 * @readonly
 */
export const MessageNames = Object.freeze({
    hello: "hello",
    frameChange: "frameChange",
    viewport: "viewport",
    blank: "blank",
    jumpToFrame: "jumpToFrame",
    next: "next",
    previous: "previous",
    custom: "custom",
    preview: "preview",
    followLink: "followLink",
    key: "key"
});

/** Who says `hello`: the deck that plays the presentation, or a surface that watches it.
 *
 * @readonly
 */
export const Roles = Object.freeze({display: "display", surface: "surface"});

/**
 * A frame as the display reports it.
 *
 * @typedef {object} FrameInfo
 * @property {number} index - The position of the frame, from 0.
 * @property {string} id - The frame's id.
 * @property {string} title - The frame's title.
 * @property {string} notes - The presenter's notes for the frame, as HTML.
 */

/**
 * What a display tells a surface in its `hello`.
 *
 * @typedef {object} DisplayState
 * @property {string} deckId - The deck's file name without `.sozi.html`.
 * @property {number} frameCount - How many frames the deck has.
 * @property {Viewport | null} viewport - The display's size, null while it has none.
 * @property {FrameInfo} frame - The current frame.
 * @property {FrameInfo[]} frames - Every frame, in deck order.
 * @property {boolean} blank - Is the blank screen shown?
 */

/** @typedef {{name: "hello", role: "surface"}} SurfaceHelloMessage */
/** @typedef {{name: "hello", role: "display"} & DisplayState} DisplayHelloMessage */
/** @typedef {SurfaceHelloMessage | DisplayHelloMessage} HelloMessage */
/** @typedef {{name: "frameChange"} & FrameInfo} FrameChangeMessage */
/** @typedef {{name: "blank", on: boolean}} BlankMessage */
/** @typedef {{name: "jumpToFrame", index: number, transition: boolean}} JumpToFrameMessage */
/** @typedef {{name: "next", transition: boolean}} NextMessage */
/** @typedef {{name: "previous", transition: boolean}} PreviousMessage */
/** @typedef {{name: "custom", type: string, data: any}} CustomMessage */
/** @typedef {{name: "preview", current: boolean}} PreviewMessage */
/** @typedef {{name: "followLink", id: string}} FollowLinkMessage */

/**
 * The modifier keys held down with a key.
 *
 * @typedef {object} KeyModifiers
 * @property {boolean} shift - Shift.
 * @property {boolean} alt - Alt (Option).
 * @property {boolean} ctrl - Control.
 * @property {boolean} meta - Meta (Command, Windows).
 */

/** @typedef {{name: "key", key: string, modifiers: KeyModifiers}} KeyMessage */

/**
 * Any message of the protocol.
 *
 * @typedef {HelloMessage | FrameChangeMessage | ViewportMessage | BlankMessage
 *   | JumpToFrameMessage | NextMessage | PreviousMessage | CustomMessage | PreviewMessage
 *   | FollowLinkMessage | KeyMessage} Message
 */

/**
 * Build a `hello`. A surface's carries its role only; a display's carries its whole state.
 *
 * @param {"display" | "surface"} role - Who says it.
 * @param {DisplayState} [state] - The display's state; a surface gives none.
 * @returns {HelloMessage} The message.
 */
export function helloMessage(role, state) {
    if (role === Roles.display) {
        const {deckId, frameCount, viewport, frame, frames, blank} = /** @type {DisplayState} */ (
            state
        );
        return {name: "hello", role, deckId, frameCount, viewport, frame, frames, blank};
    }
    return {name: "hello", role: "surface"};
}

/**
 * Build a `frameChange`: the display has moved to another frame.
 *
 * @param {FrameInfo} frame - The new current frame.
 * @returns {FrameChangeMessage} The message.
 */
export function frameChangeMessage({index, id, title, notes}) {
    return {name: "frameChange", index, id, title, notes};
}

/**
 * Build a `blank`: show or hide the blank screen, or report that it was.
 *
 * @param {boolean} on - Is the blank screen shown?
 * @returns {BlankMessage} The message.
 */
export function blankMessage(on) {
    return {name: "blank", on};
}

/**
 * Build a `jumpToFrame`: go to the frame at an index.
 *
 * @param {number} index - The frame's position, from 0.
 * @param {boolean} [transition] - Animate the move; false jumps straight there.
 * @returns {JumpToFrameMessage} The message.
 */
export function jumpToFrameMessage(index, transition = true) {
    return {name: "jumpToFrame", index, transition};
}

/**
 * Build a `next`: go to the next frame.
 *
 * @param {boolean} [transition] - Animate the move; false jumps straight there.
 * @returns {NextMessage} The message.
 */
export function nextMessage(transition = true) {
    return {name: "next", transition};
}

/**
 * Build a `previous`: go to the previous frame.
 *
 * @param {boolean} [transition] - Animate the move; false jumps straight there.
 * @returns {PreviousMessage} The message.
 */
export function previousMessage(transition = true) {
    return {name: "previous", transition};
}

/**
 * Build a `custom`: a message of an add-on's own, carried as it is.
 *
 * @param {string} type - The add-on's name for the message.
 * @param {any} data - Its content; anything `postMessage` can clone.
 * @returns {CustomMessage} The message.
 */
export function customMessage(type, data) {
    return {name: "custom", type, data};
}

/**
 * Build a `preview`: the display becomes a preview in the presenter.
 *
 * @param {boolean} current - Does it show the current frame (and forward its link clicks)?
 * @returns {PreviewMessage} The message.
 */
export function previewMessage(current) {
    return {name: "preview", current};
}

/**
 * Build a `followLink`: follow the link with this id, as if it was clicked.
 *
 * @param {string} id - The id of the link element in the deck.
 * @returns {FollowLinkMessage} The message.
 */
export function followLinkMessage(id) {
    return {name: "followLink", id};
}

/**
 * Build a `key`: a key was pressed in a preview, for the presenter to act on.
 *
 * @param {string} key - The key, as `KeyboardEvent.key` names it.
 * @param {KeyModifiers} modifiers - The modifier keys held down with it.
 * @returns {KeyMessage} The message.
 */
export function keyMessage(key, {shift, alt, ctrl, meta}) {
    return {name: "key", key, modifiers: {shift, alt, ctrl, meta}};
}

/**
 * Read the modifiers of a received `key`.
 *
 * @param {any} m - The `modifiers` field as received.
 * @returns {KeyModifiers | null} The modifiers, or null if one is missing or not a boolean.
 */
function readModifiers(m) {
    if (m === null || typeof m !== "object") {
        return null;
    }
    const {shift, alt, ctrl, meta} = m;
    const valid = [shift, alt, ctrl, meta].every(v => typeof v === "boolean");
    return valid ? {shift, alt, ctrl, meta} : null;
}

/**
 * Is it an integer from 0 up?
 *
 * @param {any} v - The value.
 * @returns {boolean} True for 0, 1, 2…
 */
function isIndex(v) {
    return Number.isInteger(v) && v >= 0;
}

/**
 * Is it a string with something in it?
 *
 * @param {any} v - The value.
 * @returns {boolean} True for a non-empty string.
 */
function isName(v) {
    return typeof v === "string" && v.length > 0;
}

/**
 * Read a received frame.
 *
 * @param {any} f - The fields of a frame.
 * @returns {FrameInfo | null} The frame, or null if a field is malformed.
 */
function readFrame(f) {
    if (f === null || typeof f !== "object") {
        return null;
    }
    const {index, id, title, notes} = f;
    const valid = isIndex(index) && [id, title, notes].every(v => typeof v === "string");
    return valid ? {index, id, title, notes} : null;
}

/**
 * Read the `frames` field of a display's `hello`.
 *
 * A display from the release before this field sends none, which reads as an empty list.
 *
 * @param {any} frames - The field as received.
 * @returns {FrameInfo[] | null} The frames, or null if the list or an entry is malformed.
 */
function readFrames(frames) {
    if (frames === undefined) {
        return [];
    }
    if (!Array.isArray(frames)) {
        return null;
    }
    const read = frames.map(readFrame);
    return read.every(frame => frame !== null) ? /** @type {FrameInfo[]} */ (read) : null;
}

/**
 * Read the `transition` field, which defaults to true.
 *
 * @param {any} transition - The field as received.
 * @returns {boolean | null} Its value, or null if it is not a boolean.
 */
function readTransition(transition) {
    if (transition === undefined) {
        return true;
    }
    return typeof transition === "boolean" ? transition : null;
}

/**
 * Read a received `hello`.
 *
 * @param {any} data - The message.
 * @returns {HelloMessage | null} The message, or null if it is malformed.
 */
function readHello(data) {
    if (data.role === Roles.surface) {
        return helloMessage(Roles.surface);
    }
    if (data.role !== Roles.display) {
        return null;
    }
    const {deckId, frameCount, blank} = data;
    const viewport =
        data.viewport === null ? null : readViewport({...data.viewport, name: "viewport"});
    const frame = readFrame(data.frame);
    const frames = readFrames(data.frames);
    const valid =
        typeof deckId === "string" &&
        isIndex(frameCount) &&
        (viewport !== null || data.viewport === null) &&
        frame !== null &&
        frames !== null &&
        typeof blank === "boolean";
    return valid
        ? helloMessage(Roles.display, {deckId, frameCount, viewport, frame, frames, blank})
        : null;
}

/**
 * Read a received `viewport`, keeping its name.
 *
 * @param {any} data - The message.
 * @returns {ViewportMessage | null} The message, or null if it is malformed.
 */
function readViewportMessage(data) {
    const viewport = readViewport(data);
    return viewport ? {name: "viewport", ...viewport} : null;
}

/**
 * Read a message whose only field is `transition`.
 *
 * @param {"next" | "previous"} name - The message name.
 * @returns {(data: any) => NextMessage | PreviousMessage | null} The reader.
 */
function readMove(name) {
    return data => {
        const transition = readTransition(data.transition);
        return transition === null ? null : {name, transition};
    };
}

/** One reader per message name: the explicit table `readMessage` dispatches from (2.5).
 *
 * @readonly
 * @type {Readonly<Record<string, (data: any) => Message | null>>}
 */
const READERS = Object.freeze({
    [MessageNames.hello]: readHello,
    [MessageNames.frameChange]: data => {
        const frame = readFrame(data);
        return frame && frameChangeMessage(frame);
    },
    [MessageNames.viewport]: readViewportMessage,
    [MessageNames.blank]: data => (typeof data.on === "boolean" ? blankMessage(data.on) : null),
    [MessageNames.jumpToFrame]: data => {
        const transition = readTransition(data.transition);
        return isIndex(data.index) && transition !== null
            ? jumpToFrameMessage(data.index, transition)
            : null;
    },
    [MessageNames.next]: readMove("next"),
    [MessageNames.previous]: readMove("previous"),
    [MessageNames.custom]: data => (isName(data.type) ? customMessage(data.type, data.data) : null),
    [MessageNames.preview]: data =>
        typeof data.current === "boolean" ? previewMessage(data.current) : null,
    [MessageNames.followLink]: data => (isName(data.id) ? followLinkMessage(data.id) : null),
    [MessageNames.key]: data => {
        const modifiers = readModifiers(data.modifiers);
        return isName(data.key) && modifiers ? keyMessage(data.key, modifiers) : null;
    }
});

/**
 * Read the data of a received message event.
 *
 * The result holds only the fields of its message, so a receiver can trust every one.
 *
 * @param {any} data - The data of a message event.
 * @returns {Message | null} The message, or null if it is not a valid protocol message.
 */
export function readMessage(data) {
    if (data === null || typeof data !== "object" || !Object.hasOwn(READERS, data.name)) {
        return null;
    }
    return READERS[data.name](data);
}

/**
 * The deck id for a page: its file name without `.sozi.html`.
 *
 * @param {string} pathname - The path of the deck's page, as `location.pathname` gives it.
 * @returns {string} The deck id.
 */
export function deckIdOf(pathname) {
    const fileName = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
    return fileName.replace(/\.sozi\.html$/, "");
}
