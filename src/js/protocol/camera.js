/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The messages a display and its surfaces exchange about the camera, and the view maths both
 * sides share.
 *
 * Everything is in viewport units: a share of the viewport's width along x, of its height along
 * y, from its top-left corner. So a view looks the same on a phone and on a laptop.
 * `readMessage` in `messages.js` reads these messages too.
 *
 * @module
 */

/**
 * Where the camera looks, relative to the current frame.
 *
 * A point `p` of the frame, in viewport units as the frame shows it, shows at `zoom·p + (x, y)`.
 *
 * @typedef {object} CameraView
 * @property {boolean} offFrame - Has the camera left its frame?
 * @property {number} zoom - How much larger the frame shows, above zero.
 * @property {number} x - Where the frame's left edge shows, in viewport units.
 * @property {number} y - Where the frame's top edge shows, in viewport units.
 */

/**
 * A move of the camera: zoom by `zoom` about `(atX, atY)`, then pan by `(x, y)`.
 *
 * @typedef {object} CameraMove
 * @property {number} x - The pan across, in viewport units; positive moves the picture right.
 * @property {number} y - The pan down, in viewport units; positive moves the picture down.
 * @property {number} zoom - The zoom factor, above 1 to zoom in.
 * @property {number} atX - The point the zoom keeps in place, across, in viewport units.
 * @property {number} atY - The point the zoom keeps in place, down, in viewport units.
 */

/** @typedef {{name: "cameraMove"} & CameraMove} CameraMoveMessage */
/** @typedef {{name: "cameraReset"}} CameraResetMessage */
/** @typedef {{name: "camera"} & CameraView} CameraMessage */

/** The camera on its frame: what a surface holds until a display reports a view, and what a
 * deck from before the camera reads as.
 *
 * @readonly
 * @type {Readonly<CameraView>}
 */
export const ON_FRAME = Object.freeze({offFrame: false, zoom: 1, x: 0, y: 0});

/**
 * Build a `cameraMove`: move the display's camera.
 *
 * @param {CameraMove} move - The move.
 * @returns {CameraMoveMessage} The message.
 */
export function cameraMoveMessage({x, y, zoom, atX, atY}) {
    return {name: "cameraMove", x, y, zoom, atX, atY};
}

/**
 * Build a `cameraReset`: put the display's camera back on the current frame.
 *
 * @returns {CameraResetMessage} The message.
 */
export function cameraResetMessage() {
    return {name: "cameraReset"};
}

/**
 * Build a `camera`: the display's view now, or, to a preview deck, the view to show.
 *
 * @param {CameraView} view - The view.
 * @returns {CameraMessage} The message.
 */
export function cameraMessage({offFrame, zoom, x, y}) {
    return {name: "camera", offFrame, zoom, x, y};
}

/**
 * Is it a finite number?
 *
 * @param {any} v - The value.
 * @returns {boolean} True for a finite number.
 */
function isNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
}

/**
 * Read a received camera view.
 *
 * @param {any} data - The fields of a view.
 * @returns {CameraView | null} The view, or null if a field is malformed.
 */
export function readCameraView(data) {
    if (data === null || typeof data !== "object") {
        return null;
    }
    const {offFrame, zoom, x, y} = data;
    const valid =
        typeof offFrame === "boolean" && isNumber(zoom) && zoom > 0 && [x, y].every(isNumber);
    return valid ? {offFrame, zoom, x, y} : null;
}

/**
 * Read a received `camera`.
 *
 * @param {any} data - The message.
 * @returns {CameraMessage | null} The message, or null if a field is malformed.
 */
export function readCamera(data) {
    const view = readCameraView(data);
    return view && cameraMessage(view);
}

/**
 * Read a received `cameraMove`.
 *
 * @param {any} data - The message.
 * @returns {CameraMoveMessage | null} The message, or null if a field is not a finite number or
 *   the zoom is not above zero.
 */
export function readCameraMove(data) {
    const {x, y, zoom, atX, atY} = data;
    const valid = [x, y, zoom, atX, atY].every(isNumber) && zoom > 0;
    return valid ? cameraMoveMessage({x, y, zoom, atX, atY}) : null;
}

/**
 * Read a received `cameraReset`.
 *
 * @returns {CameraResetMessage} The message: it has no fields to check.
 */
export function readCameraReset() {
    return cameraResetMessage();
}

/**
 * The view after a move.
 *
 * A move that moves nothing leaves the view as it was, on its frame or not.
 *
 * @param {CameraView} view - The view before.
 * @param {CameraMove} move - The move.
 * @returns {CameraView} The view after.
 */
export function composeView(view, {x, y, zoom, atX, atY}) {
    if (zoom === 1 && x === 0 && y === 0) {
        return view;
    }
    return {
        offFrame: true,
        zoom: view.zoom * zoom,
        x: zoom * (view.x - atX) + atX + x,
        y: zoom * (view.y - atY) + atY + y
    };
}
