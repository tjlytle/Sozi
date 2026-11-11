/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The window that shows a presentation HTML file for capture, and its time limits.
 *
 * @module
 */

/** @typedef {import("electron").BrowserWindow} BrowserWindow */
/** @typedef {import("electron").Debugger} Debugger */

/** Read the dimensions of a PNG image from its header.
 *
 * @param {Buffer} png - The content of a PNG file.
 * @returns {{width: number, height: number}} - The dimensions of the image.
 */
function pngSize(png) {
    return {width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
}

/** The default time limit of each step of an export, in milliseconds.
 *
 * @readonly
 * @default
 * @type {number}
 */
export const DEFAULT_TIMEOUT_MS = 30000;

/** Wait for a promise with a time limit.
 *
 * @param {Promise} promise - The promise to wait for.
 * @param {number} ms - The time limit, in milliseconds.
 * @param {string} message - The error message if the time limit is reached.
 * @returns {Promise} - Settled like `promise`, or rejected with `message` after `ms`.
 */
export function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A window that shows a presentation HTML file for capture.
 *
 * Each capture shows the state the exporter set: the window checks the frame the page
 * shows before a capture, and waits for a picture drawn after it.
 * Create instances with {@linkcode module:exporter.openExportWindow|openExportWindow}.
 * Main process only.
 */
export class ExportWindow {
    /** Wrap a browser window.
     *
     * @param {BrowserWindow} w - A browser window.
     * @param {object} opts - The options given to `openExportWindow`.
     */
    constructor(w, opts) {
        /** The browser window.
         *
         * @type {BrowserWindow}
         */
        this.window = w;

        /** The requested size of the captures, in pixels.
         *
         * @type {{width: number, height: number}}
         */
        this.size = {width: opts.width, height: opts.height};

        /** Is the page background transparent?
         *
         * @type {boolean}
         */
        this.transparent = !!opts.transparent;

        /** The capture method of each capture: `cdp`.
         *
         * @type {Set<string>}
         */
        this.captureMethods = new Set();

        /** Warnings to report in the export result.
         *
         * @type {string[]}
         */
        this.warnings = [];

        /** The time limit of each step (page load, script, capture), in milliseconds.
         *
         * @type {number}
         */
        this.timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    }

    /** Wait for an operation of the window with the time limit.
     *
     * @param {Promise} promise - The operation.
     * @param {string} what - A description of the operation for the error message.
     * @returns {Promise} - Settled like `promise`, or rejected after the time limit.
     */
    bounded(promise, what) {
        return withTimeout(
            promise,
            this.timeoutMs,
            `the export window did not respond within ${this.timeoutMs / 1000} s (${what})`
        );
    }

    /** Run a script in the page.
     *
     * @param {string} code - A JavaScript expression.
     * @returns {Promise<any>} - The value of the expression.
     */
    run(code) {
        return this.bounded(
            this.window.webContents.executeJavaScript(code),
            "script: " + code.trim().split("\n")[0].slice(0, 60)
        );
    }

    /** Wait until the page has painted its current state (two animation frames).
     *
     * @returns {Promise} - Resolved after the second animation frame.
     */
    settle() {
        return this.run(
            "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))"
        );
    }

    /** Show a frame without transition.
     *
     * @param {number} index - The index of the frame.
     * @returns {Promise} - Resolved after the frame has been painted, rejected if the page
     *  does not show it.
     */
    async jumpToFrame(index) {
        await this.run(`sozi.player.jumpToFrame(${JSON.stringify(index)})`);
        await this.settle();
        await this.expectFrame(index);
    }

    /** Check that the page shows a frame, at rest, before a capture.
     *
     * Only the exporter may move the cameras: if a frame timeout or a `hashchange` moved
     * them, the capture would show another frame. This fails the export instead.
     *
     * @param {number} index - The index of the frame the page must show.
     * @returns {Promise} - Resolved if it does and no animation runs, rejected otherwise.
     */
    async expectFrame(index) {
        const {index: shown, animating} = await this.run("sozi.exportDriver.state()");
        if (animating) {
            throw new Error(
                `the export window is animating (frame ${shown}), expected frame ${index} at rest`
            );
        }
        if (shown !== index) {
            throw new Error(`the export window shows frame ${shown}, expected ${index}`);
        }
    }

    /** Attach the Chrome DevTools Protocol debugger if not done yet.
     *
     * @returns {Promise<Debugger>} - The debugger of the window.
     */
    async attachDebugger() {
        const dbg = this.window.webContents.debugger;
        if (!dbg.isAttached()) {
            dbg.attach("1.3");
            // Render at device scale 1, so that the screenshots have the requested
            // size in pixels on high-density displays too.
            await this.bounded(
                dbg.sendCommand("Emulation.setDeviceMetricsOverride", {
                    width: this.size.width,
                    height: this.size.height,
                    deviceScaleFactor: 1,
                    mobile: false
                }),
                "device metrics override"
            );
        }
        return dbg;
    }

    /** Capture the window with the Chrome DevTools Protocol.
     *
     * @returns {Promise<Buffer>} - A PNG image.
     */
    async captureCDP() {
        const dbg = await this.attachDebugger();
        // The screenshot waits for a new frame: repaint the unchanged viewport until it arrives.
        const shot = dbg.sendCommand("Page.captureScreenshot", {format: "png"});
        // If the kick fails, the screenshot is not awaited: never leave its rejection unhandled.
        shot.catch(() => {});
        try {
            await this.run("sozi.exportDriver.kick(true)");
            const img = await this.bounded(shot, "screenshot");
            return Buffer.from(img.data, "base64");
        } finally {
            try {
                await this.run("sozi.exportDriver.kick(false)");
            } catch {
                // The page does not respond: the window will be destroyed anyway.
            }
        }
    }

    /** Capture the current state of the window as a PNG image.
     *
     * Always with the Chrome DevTools Protocol, at device scale 1: its screenshot waits for
     * a picture drawn after the request. `capturePage` copies the last picture the window
     * presented, which on a loaded machine can be one from before the last jump (#250).
     *
     * @returns {Promise<Buffer>} - A PNG image of exactly the requested size.
     */
    async capture() {
        const png = await this.captureCDP();
        this.captureMethods.add("cdp");
        const {width, height} = pngSize(png);
        if (width !== this.size.width || height !== this.size.height) {
            throw new Error(
                `captured image is ${width}x${height}, expected ${this.size.width}x${this.size.height} (is the window larger than the screen?)`
            );
        }
        return png;
    }

    /** The capture method used so far, for the export result.
     *
     * @type {?string}
     */
    get captureMethod() {
        const methods = [...this.captureMethods];
        return methods.length ? methods.join("+") : null;
    }

    /** Close the window. */
    close() {
        if (!this.window.isDestroyed()) {
            this.window.destroy();
        }
    }
}
