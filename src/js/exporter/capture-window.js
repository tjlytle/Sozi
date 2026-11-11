/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Open a presentation HTML file in a capture window, ready to capture.
 *
 * Main process only.
 *
 * @module
 */

import {BrowserWindow} from "electron";
import {ExportWindow, withTimeout} from "./ExportWindow.js";

/** Open a presentation HTML file in a capture window.
 *
 * Main process only. The window has exactly the requested content size,
 * a white background (or a transparent one), and is hidden unless `hidden` is false.
 * The promise resolves when the player is ready, with media disabled and,
 * unless `frameNumber` is true, the frame number of the player hidden.
 * Each step is bounded by `timeoutMs` (default 30 s); on failure the window is destroyed.
 *
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - `{width, height, hidden, transparent, frameNumber, timeoutMs}`.
 * @returns {Promise<ExportWindow>} - The capture window.
 */
export async function openExportWindow(htmlPath, opts) {
    const transparent = !!opts.transparent;
    const w = new BrowserWindow({
        width: opts.width,
        height: opts.height,
        useContentSize: true,
        frame: false,
        show: opts.hidden === false,
        resizable: false,
        enableLargerThanScreen: true,
        paintWhenInitiallyHidden: true,
        backgroundColor: transparent ? "#00000000" : "#ffffff",
        webPreferences: {
            nodeIntegration: false,
            backgroundThrottling: false,
            spellcheck: false
        }
    });
    // The capture window shows the presentation only: no link may navigate away or open a window.
    // eslint-disable-next-line no-restricted-syntax -- Electron's event, not ours (standard 2.4)
    w.webContents.on("will-navigate", event => event.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    const ew = new ExportWindow(w, opts);
    try {
        await ew.bounded(w.loadFile(htmlPath), `loading ${htmlPath}`);
        // The player is created in the load event handler of the page.
        await withTimeout(
            w.webContents.executeJavaScript(`new Promise(resolve => {
            (function check() {
                if (window.sozi && window.sozi.exportDriver) {
                    resolve(true);
                }
                else {
                    setTimeout(check, 10);
                }
            })();
        })`),
            ew.timeoutMs,
            `the Sozi player did not start within ${ew.timeoutMs / 1000} s in ${htmlPath}; is it a Sozi presentation HTML file?`
        );
        await prepareCapture(ew, opts);
    } catch (err) {
        ew.close();
        throw err;
    }
    return ew;
}

/** Prepare a started player for capture, as {@linkcode module:exporter.openExportWindow|openExportWindow} describes.
 *
 * @param {ExportWindow} ew - The capture window, with the player started.
 * @param {object} opts - `{transparent, frameNumber}`.
 * @returns {Promise<void>} - Resolved when the page is ready to capture.
 */
async function prepareCapture(ew, opts) {
    // Stop the player and remove the blank screen, whose fade-out is a CSS transition.
    await ew.run(`(() => {
        sozi.player.disableMedia();
        sozi.player.pause();
        const blankScreen = document.querySelector(".sozi-blank-screen");
        if (blankScreen) {
            blankScreen.style.display = "none";
        }
        // The player sets the visibility of the frame number at each frame change, not its display.
        const frameNumber = document.querySelector(".sozi-frame-number");
        if (frameNumber && ${!opts.frameNumber}) {
            frameNumber.style.display = "none";
        }
        return true;
    })()`);
    if (opts.transparent) {
        const dbg = await ew.attachDebugger();
        await ew.bounded(
            dbg.sendCommand("Emulation.setDefaultBackgroundColorOverride", {
                color: {r: 0, g: 0, b: 0, a: 0}
            }),
            "background override"
        );
    }
}

/** Open a capture window, run an operation with it and destroy it.
 *
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The options of {@linkcode module:exporter.openExportWindow|openExportWindow}.
 * @param {function(ExportWindow):Promise<any>} fn - The operation.
 * @returns {Promise<{value: any, warnings: string[], capture: ?string}>} - The result of the operation and the capture report.
 */
export async function withExportWindow(htmlPath, opts, fn) {
    const ew = await openExportWindow(htmlPath, opts);
    try {
        const value = await fn(ew);
        return {value, warnings: ew.warnings, capture: ew.captureMethod};
    } finally {
        ew.close();
    }
}
