/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The `hello` a display and its surfaces exchange when they meet, and the frames it carries.
 *
 * `readMessage` in `messages.js` reads it too.
 *
 * @module
 */

import {ON_FRAME, readCameraView} from "./camera.js";
import {readPresets} from "./layoutPresets.js";
import {STOPPED_TIMER, readTimerState} from "./timer.js";
import {readViewport} from "./viewport.js";
import {EMPTY_DRAWINGS, readDrawings} from "./drawings.js";
import {readCanvas} from "./canvas.js";

/** @typedef {import("./layoutPresets.js").LayoutPreset} LayoutPreset */
/** @typedef {import("./viewport.js").Viewport} Viewport */
/** @typedef {import("./timer.js").TimerState} TimerState */
/** @typedef {import("./camera.js").CameraView} CameraView */
/** @typedef {import("./drawings.js").Drawings} Drawings */
/** @typedef {import("./canvas.js").Canvas} Canvas */

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
 * @property {string} notes - The frame's notes as stored in the deck: an HTML fragment, not
 *     sanitized, never Markdown.
 */

/**
 * What a display tells a surface in its `hello`.
 *
 * @typedef {object} DisplayState
 * @property {string} deckId - The deck's file name without `.sozi.html`.
 * @property {string} [version] - The date of the deck's page, as `document.lastModified` gives it.
 * @property {number} frameCount - How many frames the deck has.
 * @property {Viewport | null} viewport - The display's size, null while it has none.
 * @property {FrameInfo} frame - The current frame.
 * @property {FrameInfo[]} frames - Every frame, in deck order.
 * @property {boolean} blank - Is the blank screen shown?
 * @property {Record<string, LayoutPreset>} [layouts] - The deck's layout presets, in order.
 * @property {TimerState} [timer] - The talk timer as it is now.
 * @property {CameraView} [camera] - Where the camera looks, relative to the current frame.
 * @property {Drawings} [drawings] - The drawings on the deck, every stroke included.
 * @property {?Canvas} [canvas] - The source SVG's `viewBox`, `width` and `height`, null for a
 *     deck built before they were recorded.
 */

/** @typedef {{name: "hello", role: "surface"}} SurfaceHelloMessage */
/** @typedef {{name: "hello", role: "display"} & DisplayState} DisplayHelloMessage */
/** @typedef {SurfaceHelloMessage | DisplayHelloMessage} HelloMessage */

/**
 * Build a `hello`. A surface's carries its role only; a display's carries its whole state.
 *
 * @param {"display" | "surface"} role - Who says it.
 * @param {DisplayState} [state] - The display's state; a surface gives none.
 * @returns {HelloMessage} The message.
 */
export function helloMessage(role, state) {
    if (role === Roles.display) {
        const {
            deckId,
            version = "",
            frameCount,
            viewport,
            frame,
            frames,
            blank,
            layouts = {},
            timer = STOPPED_TIMER,
            camera = ON_FRAME,
            drawings = EMPTY_DRAWINGS,
            canvas = null
        } = /** @type {DisplayState} */ (state);
        return {
            name: "hello",
            role,
            deckId,
            version,
            frameCount,
            viewport,
            frame,
            frames,
            blank,
            layouts,
            timer,
            camera,
            drawings,
            canvas
        };
    }
    return {name: "hello", role: "surface"};
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
 * Read a received frame.
 *
 * @param {any} f - The fields of a frame.
 * @returns {FrameInfo | null} The frame, or null if a field is malformed.
 */
export function readFrame(f) {
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
 * Read a received `hello`.
 *
 * A missing `version`, `frames` or `layouts` reads as none, a missing `timer` as a stopped one, a
 * missing `camera` as on its frame, missing `drawings` as empty and a missing `canvas` as null, so
 * a newer surface can join an older deck. A bad preset is dropped, never the whole message; a
 * malformed `frames`, `timer`, `camera`, `drawings` or `canvas` refuses it.
 *
 * @param {any} data - The message.
 * @returns {HelloMessage | null} The message, or null if it is malformed.
 */
export function readHello(data) {
    if (data.role === Roles.surface) {
        return helloMessage(Roles.surface);
    }
    if (data.role !== Roles.display) {
        return null;
    }
    const {deckId, frameCount, blank, version = ""} = data;
    const viewport =
        data.viewport === null ? null : readViewport({...data.viewport, name: "viewport"});
    const frame = readFrame(data.frame);
    const frames = readFrames(data.frames);
    const timer = data.timer === undefined ? STOPPED_TIMER : readTimerState(data.timer);
    const camera = data.camera === undefined ? ON_FRAME : readCameraView(data.camera);
    const drawings = data.drawings === undefined ? EMPTY_DRAWINGS : readDrawings(data.drawings);
    const noCanvas = data.canvas === undefined || data.canvas === null;
    const canvas = noCanvas ? null : readCanvas(data.canvas);
    const valid =
        typeof deckId === "string" &&
        typeof version === "string" &&
        isIndex(frameCount) &&
        (viewport !== null || data.viewport === null) &&
        frame !== null &&
        frames !== null &&
        typeof blank === "boolean" &&
        timer !== null &&
        camera !== null &&
        drawings !== null &&
        (canvas !== null || noCanvas);
    const layouts = readPresets(data.layouts).presets;
    return valid
        ? helloMessage(Roles.display, {
              deckId,
              version,
              frameCount,
              viewport,
              frame,
              frames,
              blank,
              layouts,
              timer,
              camera,
              drawings,
              canvas
          })
        : null;
}

/**
 * The deck id for a page: its file name without `.sozi.html`, for a display's `hello`.
 *
 * @param {string} pathname - The path of the deck's page, as `location.pathname` gives it.
 * @returns {string} The deck id.
 */
export function deckIdOf(pathname) {
    const fileName = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
    return fileName.replace(/\.sozi\.html$/, "");
}
