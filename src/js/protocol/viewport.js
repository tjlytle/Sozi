/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The size of the display window, as the display reports it to a presenter.
 *
 * @typedef {object} Viewport
 * @property {number} width - The inner width of the display, in CSS pixels.
 * @property {number} height - The inner height of the display, in CSS pixels.
 * @property {number} pixelRatio - Device pixels per CSS pixel.
 */

/**
 * The `viewport` message: a {@link Viewport} with its name.
 *
 * @typedef {{name: "viewport"} & Viewport} ViewportMessage
 */

/**
 * Build the `viewport` message for a window.
 *
 * @param {{innerWidth: number, innerHeight: number, devicePixelRatio: number}} source - The display window.
 * @returns {ViewportMessage} The message that reports its size.
 */
export function viewportMessage({innerWidth, innerHeight, devicePixelRatio}) {
    return {name: "viewport", width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio};
}

/**
 * Read a received `viewport` message.
 *
 * A minimised window reports a zero size, so every field must be a positive finite number.
 *
 * @param {any} data - The data of a message event.
 * @returns {Viewport | null} The reported viewport, or null if the data is not a valid `viewport` message.
 */
export function readViewport(data) {
    if (data === null || typeof data !== "object" || data.name !== "viewport") {
        return null;
    }
    const {width, height, pixelRatio} = data;
    const valid = [width, height, pixelRatio].every(
        v => typeof v === "number" && Number.isFinite(v) && v > 0
    );
    return valid ? {width, height, pixelRatio} : null;
}

/**
 * Send the size of a window to a presenter.
 *
 * @param {{postMessage: (message: any, targetOrigin: string) => void}} target - The presenter window.
 * @param {{innerWidth: number, innerHeight: number, devicePixelRatio: number}} source - The display window.
 */
export function postViewport(target, source) {
    target.postMessage(viewportMessage(source), "*");
}
