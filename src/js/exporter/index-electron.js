/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Export a presentation to PDF, PPTX, video or a PNG sequence.
 *
 * The export functions drive a capture window that loads the generated
 * presentation HTML. They run in the main process, where they create a plain
 * `BrowserWindow`. Called from a renderer (the editor and the command line),
 * they forward the call to this same module in the main process through
 * `@electron/remote`, so there is a single implementation of the driving logic.
 *
 * The capture window is hidden by default (`show:false`, no background
 * throttling); set the environment variable `SOZI_EXPORT_SHOW` or the option
 * `hidden:false` to watch it. Frames and transition steps are driven by
 * stepping the player through `webContents.executeJavaScript`, one capture per
 * step, after two animation frames: never by wall-clock time.
 *
 * @module
 */

import {BrowserWindow} from "electron";
import path from "path";
import process from "process";
import * as tmp from "tmp";
import * as fs from "fs";
import {PDFDocument} from "pdf-lib";
import officegen from "officegen";
import {spawn} from "child_process";

/** Update the status of a sequence of frame numbers to include or exclude in the export.
 *
 * @param {boolean[]} list - The status of each frame of the presentation.
 * @param {number} first - The index of the first element to update.
 * @param {number} last - The index of the last element to update.
 * @param {number} step - The step between elements to update.
 * @param {boolean} value - The value to assign at each index.
 */
function markInterval(list, first, last, step, value) {
    if (step > 0) {
        for (let i = first; i <= last; i += step) {
            if (i >= 0 && i < list.length) {
                list[i] = value;
            }
        }
    }
}

/** Parse a list of frames to include or exclude from the export.
 *
 * ```
 * expr ::= interval ("," interval)*
 *
 * interval ::=
 *      INT                     // frame number
 *    | INT? ":" INT?           // first:last
 *    | INT? ":" INT? ":" INT?  // first:second:last
 * ```
 *
 * In an interval:
 * - If `first` is omitted, it is set to 1.
 * - If `second` is omitted, it is set to `first + 1`.
 * - If `last` is omitted, it is set to `list.length`.
 *
 * @param {boolean[]} list - The status of each frame of the presentation.
 * @param {string} expr - An expression that represents a list of frames.
 * @param {boolean} value - The value to assign for each frame to mark.
 */
function markFrames(list, expr, value) {
    expr = (expr || "").trim();
    if (!expr.length) {
        expr = value ? "all" : "none";
    }
    switch (expr) {
        case "all":
            markInterval(list, 0, list.length - 1, 1, value);
            break;
        case "none":
            break;
        default:
            for (let intervalDef of expr.split(",")) {
                const interval = intervalDef.split(":").map(s => s.trim());
                if (interval.length > 0) {
                    const first  = interval[0]                        !== "" ? parseInt(interval[0])                   - 1 : 0;
                    const last   = interval[interval.length - 1]      !== "" ? parseInt(interval[interval.length - 1]) - 1 : list.length - 1;
                    const second = interval.length > 2 && interval[1] !== "" ? parseInt(interval[1])                   - 1 : first + 1;
                    if (!isNaN(first) && !isNaN(second) && !isNaN(last)) {
                        markInterval(list, first, last, second - first, value);
                    }
                }
            }
    }
}

/** Get the indices of the frames to export.
 *
 * @param {number} frameCount - The number of frames in the presentation.
 * @param {string} include - An expression that represents a list of frames to include (frame-list grammar, 1-based).
 * @param {string} exclude - An expression that represents a list of frames to exclude.
 * @returns {number[]} - The 0-based indices of the selected frames, in increasing order.
 */
export function selectFrames(frameCount, include, exclude) {
    const list = new Array(frameCount).fill(false);
    markFrames(list, include, true);
    markFrames(list, exclude, false);
    const result = [];
    list.forEach((selected, index) => {
        if (selected) {
            result.push(index);
        }
    });
    return result;
}

/** The available page sizes for PDF export.
 *
 * Page sizes are in pixels, assuming a resolution of 96 dpi,
 * for each format supported by the `printToPDF` function of the Electron API.
 * All formats are in landscape mode by default.
 *
 * @readonly
 * @type {object}
 */
const pdfPageGeometry = {
    A3     : {width: 1587, height: 1123},
    A4     : {width: 1123, height: 794},
    A5     : {width: 794 , height: 559},
    Legal  : {width: 1344, height: 816},
    Letter : {width: 1056, height: 816},
    Tabloid: {width: 1632, height: 1056},
};

/** The available slide sizes for PPTX export.
 *
 * Slide sizes are represented by aspect ratios regardless of a physical size.
 * The export function will assume a screen height equal to 1080 pixels.
 * The keys represent all formats supported by the Officegen PPTX API.
 * All formats are in landscape mode by default.
 *
 * @readonly
 * @type {object}
 */
const pptxSlideGeometry = {
    "35mm"     : {width: 11.25, height: 7.5}, // in
    A3         : {width: 420,   height: 297}, // mm
    A4         : {width: 297,   height: 210}, // mm
    B4ISO      : {width: 353,   height: 250}, // mm
    B4JIS      : {width: 364,   height: 257}, // mm
    B5ISO      : {width: 250,   height: 176}, // mm
    B5JIS      : {width: 257,   height: 182}, // mm
    banner     : {width: 8,     height: 1},   // in
    hagakiCard : {width: 148,   height: 100}, // mm
    ledger     : {width: 17,    height: 11},  // in
    letter     : {width: 11,    height: 8.5}, // in
    overhead   : {width: 10,    height: 7.5}, // in
    screen16x10: {width: 16,    height: 10},  // no unit
    screen16x9 : {width: 16,    height: 9},   // no unit
    screen4x3  : {width: 4,     height: 3}    // no unit
};

/** The default height of PPTX slides, in pixels.
 *
 * @readonly
 * @default
 * @type {number}
 */
const pptxSlideHeightPx = 1080;

/** The names of the presentation properties that the exporter reads.
 *
 * @readonly
 * @type {string[]}
 */
const settingNames = [
    "exportToPDFPageSize", "exportToPDFPageOrientation", "exportToPDFInclude", "exportToPDFExclude",
    "exportToPPTXSlideSize", "exportToPPTXInclude", "exportToPPTXExclude",
    "exportToVideoFormat", "exportToVideoWidth", "exportToVideoHeight",
    "exportToVideoFrameRate", "exportToVideoBitRate"
];

/** Copy the export settings and frame timings of a presentation into a plain object.
 *
 * @param {object} presentation - A presentation, or a plain object with the same export fields.
 * @returns {object} - The `exportTo*` fields and `frames[{timeoutMs, timeoutEnable, transitionDurationMs}]`.
 */
export function exportSettings(presentation) {
    const result = {};
    for (const name of settingNames) {
        result[name] = presentation[name];
    }
    result.frames = presentation.frames.map(f => ({
        timeoutMs           : f.timeoutMs,
        timeoutEnable       : f.timeoutEnable,
        transitionDurationMs: f.transitionDurationMs
    }));
    return result;
}

/** Compute the sequence of captures of a video export.
 *
 * The video starts at the first frame and holds each frame for its timeout
 * (at least one image, even when the timeout is 0), then plays the transition
 * to the next frame, one image per time step. After the last frame, it plays
 * the transition back to the first frame only if the last frame has its
 * timeout enabled; the video ends when it reaches the first frame again.
 *
 * @param {object[]} frames - The frames, with `timeoutMs`, `timeoutEnable` and `transitionDurationMs`.
 * @param {number} frameRate - The number of images per second.
 * @returns {object[]} - A list of `{type: "hold", frame, count}` and `{type: "transition", to, progress: number[]}`.
 */
export function videoTimeline(frames, frameRate) {
    const timeStepMs = 1000 / frameRate;
    const steps = [];
    let index = 0;
    for (;;) {
        // Ensure at least one image of each frame.
        const holdMs = frames[index].timeoutMs;
        let count = 0;
        while (count * timeStepMs < holdMs) {
            count ++;
        }
        steps.push({type: "hold", frame: index, count: Math.max(count, 1)});

        const next = (index + 1) % frames.length;
        if (next === 0 && !frames[index].timeoutEnable) {
            break;
        }

        const durationMs = frames[next].transitionDurationMs;
        const progress = [];
        for (let k = 0; k * timeStepMs < durationMs; k ++) {
            progress.push(k * timeStepMs / durationMs);
        }
        steps.push({type: "transition", to: next, progress});

        if (next === 0) {
            break;
        }
        index = next;
    }
    return steps;
}

/** Count the images of a video timeline.
 *
 * @param {object[]} timeline - The result of {@linkcode module:exporter.videoTimeline|videoTimeline}.
 * @returns {number} - The number of images.
 */
export function timelineImageCount(timeline) {
    return timeline.reduce((n, s) => n + (s.type === "hold" ? s.count : s.progress.length), 0);
}

/** Check whether a file is an executable regular file.
 *
 * @param {string} fileName - A file name.
 * @returns {boolean} - `true` if the file can be executed.
 */
function isExecutable(fileName) {
    try {
        fs.accessSync(fileName, fs.constants.X_OK);
        return fs.statSync(fileName).isFile();
    }
    catch (e) {
        return false;
    }
}

/** Find an ffmpeg executable.
 *
 * Lookup order: an explicit path if given (it must exist), then `ffmpeg`
 * on the `PATH`, then the executable bundled in `process.resourcesPath`.
 *
 * @param {?string} explicitPath - A path given by the user, or `null`.
 * @returns {?string} - The path of an ffmpeg executable, or `null` if none was found.
 */
export function findFfmpeg(explicitPath = null) {
    if (explicitPath) {
        return isExecutable(explicitPath) ? path.resolve(explicitPath) : null;
    }
    const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
        if (dir && isExecutable(path.join(dir, exe))) {
            return path.join(dir, exe);
        }
    }
    if (process.resourcesPath && isExecutable(path.join(process.resourcesPath, exe))) {
        return path.join(process.resourcesPath, exe);
    }
    return null;
}

/** Run ffmpeg and wait for it to terminate.
 *
 * @param {string} ffmpegPath - The ffmpeg executable.
 * @param {string[]} args - The command-line arguments.
 * @returns {Promise} - Resolved when ffmpeg succeeds; rejected with its status and the end of its standard error otherwise.
 */
function runFfmpeg(ffmpegPath, args) {
    return new Promise((resolve, reject) => {
        let stderr = "";
        const child = spawn(ffmpegPath, args, {stdio: ["ignore", "ignore", "pipe"]});
        child.stderr.on("data", chunk => {
            // Keep the end of the output, where ffmpeg explains failures.
            stderr = (stderr + chunk).slice(-4000);
        });
        child.on("error", err => reject(new Error(`could not run ${ffmpegPath}: ${err.message}`)));
        child.on("close", (code, signal) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`ffmpeg failed (${signal ? "signal " + signal : "exit status " + code}): ${stderr.trim()}`));
            }
        });
    });
}

/** Read the dimensions of a PNG image from its header.
 *
 * @param {Buffer} png - The content of a PNG file.
 * @returns {{width: number, height: number}} - The dimensions of the image.
 */
function pngSize(png) {
    return {width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
}

/** Check whether all the pixels of an image have the same colour.
 *
 * @param {Electron.NativeImage} img - An image.
 * @returns {boolean} - `true` if the image is uniform.
 */
function isUniform(img) {
    const bitmap = img.toBitmap();
    if (bitmap.length < 4) {
        return true;
    }
    const first = bitmap.readUInt32LE(0);
    for (let i = 4; i + 4 <= bitmap.length; i += 4) {
        if (bitmap.readUInt32LE(i) !== first) {
            return false;
        }
    }
    return true;
}

/** The default time limit of each step of an export, in milliseconds.
 *
 * @readonly
 * @default
 * @type {number}
 */
const DEFAULT_TIMEOUT_MS = 30000;

/** Wait for a promise with a time limit.
 *
 * @param {Promise} promise - The promise to wait for.
 * @param {number} ms - The time limit, in milliseconds.
 * @param {string} message - The error message if the time limit is reached.
 * @returns {Promise} - Settled like `promise`, or rejected with `message` after `ms`.
 */
function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A window that shows a presentation HTML file for capture.
 *
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

        /** Capture with the Chrome DevTools Protocol instead of `capturePage`.
         *
         * Set after `capturePage` returned an empty image once, and for transparent captures.
         *
         * @type {boolean}
         */
        this.useCDP = this.transparent;

        /** The capture method of each capture: `capturePage` or `cdp`.
         *
         * @type {Set<string>}
         */
        this.captureMethods = new Set();

        /** Warnings to report in the export result.
         *
         * @type {string[]}
         */
        this.warnings = [];

        /** Does the SVG document have visible content? Computed on demand.
         *
         * @type {?boolean}
         */
        this.hasContent = null;

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
        return withTimeout(promise, this.timeoutMs, `the export window did not respond within ${this.timeoutMs / 1000} s (${what})`);
    }

    /** Run a script in the page.
     *
     * @param {string} code - A JavaScript expression.
     * @returns {Promise<any>} - The value of the expression.
     */
    run(code) {
        return this.bounded(this.window.webContents.executeJavaScript(code), "script: " + code.trim().split("\n")[0].slice(0, 60));
    }

    /** Wait until the page has painted its current state (two animation frames).
     *
     * @returns {Promise} - Resolved after the second animation frame.
     */
    settle() {
        return this.run("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
    }

    /** Show a frame without transition.
     *
     * @param {number|string} frame - A frame index or identifier.
     * @returns {Promise} - Resolved after the frame has been painted.
     */
    async jumpToFrame(frame) {
        await this.run(`sozi.player.jumpToFrame(${JSON.stringify(frame)})`);
        await this.settle();
    }

    /** Attach the Chrome DevTools Protocol debugger if not done yet.
     *
     * @returns {Electron.Debugger} - The debugger of the window.
     */
    async attachDebugger() {
        const dbg = this.window.webContents.debugger;
        if (!dbg.isAttached()) {
            dbg.attach("1.3");
            // Render at device scale 1, so that the screenshots have the requested
            // size in pixels on high-density displays too.
            await this.bounded(dbg.sendCommand("Emulation.setDeviceMetricsOverride", {
                width: this.size.width, height: this.size.height, deviceScaleFactor: 1, mobile: false
            }), "device metrics override");
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
        try {
            await this.run("__soziExport.kick(true)");
            const img = await this.bounded(shot, "screenshot");
            return Buffer.from(img.data, "base64");
        }
        finally {
            try {
                await this.run("__soziExport.kick(false)");
            }
            catch (e) {
                // The page does not respond: the window will be destroyed anyway.
            }
        }
    }

    /** Does the SVG document have visible content? Computed once.
     *
     * @returns {Promise<boolean>} - `true` if the bounding box of the SVG root is not empty.
     */
    async svgHasContent() {
        if (this.hasContent === null) {
            this.hasContent = await this.run(`(() => {
                const svg = document.querySelector("svg");
                const box = svg && svg.getBBox();
                return !!box && box.width > 0 && box.height > 0;
            })()`);
        }
        return this.hasContent;
    }

    /** Capture the current state of the window as a PNG image.
     *
     * Uses `capturePage`, and falls back to the Chrome DevTools Protocol (at device
     * scale 1) if the image is empty, has another size (high-density display),
     * or is uniform while the SVG has visible content, even after waiting for a paint.
     *
     * @returns {Promise<Buffer>} - A PNG image of exactly the requested size.
     */
    async capture() {
        let png;
        if (!this.useCDP) {
            let img = await this.bounded(this.window.webContents.capturePage(), "capturePage");
            if (!img.isEmpty() && isUniform(img) && await this.svgHasContent()) {
                // The first capture of a hidden window can come before its first
                // paint (an all-black image): wait for a paint and capture again once.
                await this.settle();
                img = await this.bounded(this.window.webContents.capturePage(), "capturePage");
            }
            const size = img.getSize();
            if (img.isEmpty()) {
                this.useCDP = true;
                this.warnings.push("capturePage returned an empty image; captured with the Chrome DevTools Protocol (Page.captureScreenshot) instead");
            }
            else if (size.width !== this.size.width || size.height !== this.size.height) {
                // On a high-density display, capturePage returns device pixels.
                this.useCDP = true;
                this.warnings.push(`capturePage returned a ${size.width}x${size.height} image (display scale factor?); captured with the Chrome DevTools Protocol at device scale 1 instead`);
            }
            else if (isUniform(img) && await this.svgHasContent()) {
                this.useCDP = true;
                this.warnings.push("capturePage returned a uniform image of a non-empty SVG; captured with the Chrome DevTools Protocol (Page.captureScreenshot) instead");
            }
            else {
                png = img.toPNG();
                this.captureMethods.add("capturePage");
            }
        }
        if (!png) {
            png = await this.captureCDP();
            this.captureMethods.add("cdp");
        }
        const {width, height} = pngSize(png);
        if (width !== this.size.width || height !== this.size.height) {
            throw new Error(`captured image is ${width}x${height}, expected ${this.size.width}x${this.size.height} (is the window larger than the screen?)`);
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

/** Open a presentation HTML file in a capture window.
 *
 * Main process only. The window has exactly the requested content size,
 * a white background (or a transparent one), and is hidden unless `hidden` is false.
 * The promise resolves when the player is ready, with media disabled.
 * Each step is bounded by `timeoutMs` (default 30 s); on failure the window is destroyed.
 *
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - `{width, height, hidden, transparent, timeoutMs}`.
 * @returns {Promise<module:exporter.ExportWindow>} - The capture window.
 */
export async function openExportWindow(htmlPath, opts) {
    const transparent = !!opts.transparent;
    const w = new BrowserWindow({
        width          : opts.width,
        height         : opts.height,
        useContentSize : true,
        frame          : false,
        show           : opts.hidden === false,
        resizable      : false,
        enableLargerThanScreen: true,
        paintWhenInitiallyHidden: true,
        backgroundColor: transparent ? "#00000000" : "#ffffff",
        webPreferences : {
            preload             : path.join(__dirname, "exporter-preload.js"),
            contextIsolation    : false,
            nodeIntegration     : false,
            backgroundThrottling: false,
            spellcheck          : false
        }
    });
    const ew = new ExportWindow(w, opts);
    try {
        await ew.bounded(w.loadFile(htmlPath), `loading ${htmlPath}`);
        // The player is created in the load event handler of the page.
        await withTimeout(w.webContents.executeJavaScript(`new Promise(resolve => {
            (function check() {
                if (window.sozi && window.sozi.player && window.__soziExport) {
                    resolve(true);
                }
                else {
                    setTimeout(check, 10);
                }
            })();
        })`), ew.timeoutMs, `the Sozi player did not start within ${ew.timeoutMs / 1000} s in ${htmlPath}; is it a Sozi presentation HTML file?`);
        // Stop the player and remove the blank screen, whose fade-out is a CSS transition.
        await ew.run(`(() => {
            sozi.player.disableMedia();
            sozi.player.pause();
            const blankScreen = document.querySelector(".sozi-blank-screen");
            if (blankScreen) {
                blankScreen.style.display = "none";
            }
            return true;
        })()`);
        if (transparent) {
            const dbg = await ew.attachDebugger();
            await ew.bounded(dbg.sendCommand("Emulation.setDefaultBackgroundColorOverride", {color: {r: 0, g: 0, b: 0, a: 0}}), "background override");
        }
    }
    catch (err) {
        ew.close();
        throw err;
    }
    return ew;
}

/** Open a capture window, run an operation with it and destroy it.
 *
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The options of {@linkcode module:exporter.openExportWindow|openExportWindow}.
 * @param {function(module:exporter.ExportWindow):Promise} fn - The operation.
 * @returns {Promise<{value: any, warnings: string[], capture: ?string}>} - The result of the operation and the capture report.
 */
async function withExportWindow(htmlPath, opts, fn) {
    const ew = await openExportWindow(htmlPath, opts);
    try {
        const value = await fn(ew);
        return {value, warnings: ew.warnings, capture: ew.captureMethod};
    }
    finally {
        ew.close();
    }
}

/** Fill the default options of an export.
 *
 * @param {object} opts - The options given by the caller.
 * @returns {object} - The options with defaults.
 */
function withDefaults(opts) {
    return Object.assign({
        outPath    : null,
        ffmpegPath : null,
        hidden     : !process.env.SOZI_EXPORT_SHOW,
        transparent: false,
        timeoutMs  : DEFAULT_TIMEOUT_MS,
        onProgress : null
    }, opts || {});
}

/** Report progress to the caller, ignoring errors in the callback.
 *
 * @param {object} opts - The export options.
 * @param {number} done - The number of steps done.
 * @param {number} total - The total number of steps.
 */
function progress(opts, done, total) {
    if (typeof opts.onProgress === "function") {
        try {
            opts.onProgress({done, total});
        }
        catch (e) {
            // A failing progress callback must not break the export.
        }
    }
}

/** Select the frames of an export, and reject an empty selection.
 *
 * @param {object} presentation - The presentation settings.
 * @param {string} include - The frames to include (frame-list grammar).
 * @param {string} exclude - The frames to exclude.
 * @returns {number[]} - The 0-based indices of the selected frames.
 */
function requireFrames(presentation, include, exclude) {
    const frames = selectFrames(presentation.frames.length, include, exclude);
    if (!frames.length) {
        throw new Error("no frames selected for export");
    }
    return frames;
}

/** Forward an export call to this module in the main process.
 *
 * @param {string} name - The name of the export function.
 * @param {object} presentation - A presentation or presentation-like object.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The export options.
 * @returns {Promise<object>} - The export result.
 */
async function inMainProcess(name, presentation, htmlPath, opts) {
    const remote = require("@electron/remote");
    const mainModule = remote.require(__filename);
    const plainOpts = Object.assign({}, opts || {});
    const onProgress = plainOpts.onProgress || null;
    delete plainOpts.onProgress;
    const args = JSON.stringify([exportSettings(presentation), htmlPath, plainOpts]);
    return JSON.parse(await mainModule.runExport(name, args, onProgress));
}

/** Run an export function in the main process.
 *
 * In a renderer, the call is forwarded to this module in the main process.
 * In the main process, the implementation runs with the default options filled in.
 *
 * @param {string} name - The name of the exported function (a key of `exportFunctions`).
 * @param {object} presentation - A presentation or presentation-like object.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The export options.
 * @param {function(object, string, object):Promise<object>} impl - The implementation.
 * @returns {Promise<object>} - The export result.
 */
function dispatch(name, presentation, htmlPath, opts, impl) {
    if (process.type === "renderer") {
        return inMainProcess(name, presentation, htmlPath, opts);
    }
    return impl(presentation, htmlPath, withDefaults(opts));
}

/** Entry point of the export functions called from a renderer.
 *
 * Arguments and result go through JSON so that `@electron/remote`
 * copies them instead of creating remote objects.
 *
 * @param {string} name - The name of the export function.
 * @param {string} argsJSON - The presentation settings, HTML path and options as a JSON array.
 * @param {?Function} onProgress - A progress callback, or `null`.
 * @returns {Promise<string>} - The export result as JSON.
 */
export async function runExport(name, argsJSON, onProgress) {
    if (!Object.hasOwn(exportFunctions, name)) {
        throw new Error(`unknown export function: ${name}`);
    }
    const [presentation, htmlPath, opts] = JSON.parse(argsJSON);
    if (onProgress) {
        opts.onProgress = onProgress;
    }
    return JSON.stringify(await exportFunctions[name](presentation, htmlPath, opts));
}

/** Export a presentation to a PDF document.
 *
 * @param {object} presentation - The presentation, or a plain object with the `exportToPDF*` fields and `frames`.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} [opts] - `{outPath, hidden, timeoutMs, onProgress}`; `outPath` defaults to the HTML path with a `.pdf` extension.
 * @returns {Promise<object>} - `{out, frames, warnings, capture}`.
 */
export function exportToPDF(presentation, htmlPath, opts) {
    return dispatch("exportToPDF", presentation, htmlPath, opts, pdfExport);
}

/** Implementation of {@linkcode module:exporter.exportToPDF|exportToPDF} (main process).
 *
 * @param {object} presentation - The presentation settings.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The export options, with defaults.
 * @returns {Promise<object>} - The export result.
 */
async function pdfExport(presentation, htmlPath, opts) {
    const outPath = opts.outPath || htmlPath.replace(/html$/, "pdf");
    const frames  = requireFrames(presentation, presentation.exportToPDFInclude, presentation.exportToPDFExclude);

    // Get the PDF page size and swap width and height in portrait orientation.
    const geometry = pdfPageGeometry[presentation.exportToPDFPageSize];
    if (!geometry) {
        throw new Error(`unknown PDF page size: ${presentation.exportToPDFPageSize}`);
    }
    const landscape = presentation.exportToPDFPageOrientation !== "portrait";
    const g = landscape ? geometry : {width: geometry.height, height: geometry.width};

    const {warnings} = await withExportWindow(htmlPath, Object.assign({}, opts, g, {transparent: false}), async ew => {
        const pdfDoc = await PDFDocument.create();
        for (let i = 0; i < frames.length; i ++) {
            await ew.jumpToFrame(frames[i]);
            const pdfData = await ew.bounded(ew.window.webContents.printToPDF({
                pageSize       : presentation.exportToPDFPageSize,
                landscape,
                printBackground: true,
                margins        : {top: 0, bottom: 0, left: 0, right: 0}
            }), "printToPDF");
            const pdfDocForFrame = await PDFDocument.load(pdfData);
            const [pdfPage]      = await pdfDoc.copyPages(pdfDocForFrame, [0]);
            pdfDoc.addPage(pdfPage);
            progress(opts, i + 1, frames.length);
        }
        fs.writeFileSync(outPath, await pdfDoc.save());
    });
    return {out: outPath, frames: frames.length, warnings, capture: "printToPDF"};
}

/** Export a presentation to a PPTX document.
 *
 * @param {object} presentation - The presentation, or a plain object with the `exportToPPTX*` fields and `frames`.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} [opts] - `{outPath, hidden, timeoutMs, onProgress}`; `outPath` defaults to the HTML path with a `.pptx` extension.
 * @returns {Promise<object>} - `{out, frames, warnings, capture}`.
 */
export function exportToPPTX(presentation, htmlPath, opts) {
    return dispatch("exportToPPTX", presentation, htmlPath, opts, pptxExport);
}

/** Implementation of {@linkcode module:exporter.exportToPPTX|exportToPPTX} (main process).
 *
 * @param {object} presentation - The presentation settings.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The export options, with defaults.
 * @returns {Promise<object>} - The export result.
 */
async function pptxExport(presentation, htmlPath, opts) {
    const outPath = opts.outPath || htmlPath.replace(/html$/, "pptx");
    const frames  = requireFrames(presentation, presentation.exportToPPTXInclude, presentation.exportToPPTXExclude);

    // Get the PPTX slide size and convert it to pixels.
    const geometry = pptxSlideGeometry[presentation.exportToPPTXSlideSize];
    if (!geometry) {
        throw new Error(`unknown PPTX slide size: ${presentation.exportToPPTXSlideSize}`);
    }
    const g = {
        width : Math.round(geometry.width * pptxSlideHeightPx / geometry.height),
        height: pptxSlideHeightPx
    };

    // A temporary directory for the slide images, deleted even if not empty.
    const destDir = tmp.dirSync({unsafeCleanup: true});
    try {
        const pptxDoc = officegen("pptx");
        pptxDoc.setSlideSize(g.width, g.height, presentation.exportToPPTXSlideSize);

        const {warnings, capture} = await withExportWindow(htmlPath, Object.assign({}, opts, g, {transparent: false}), async ew => {
            for (let i = 0; i < frames.length; i ++) {
                await ew.jumpToFrame(frames[i]);
                const fileName = path.join(destDir.name, `img${String(i).padStart(6, "0")}.png`);
                fs.writeFileSync(fileName, await ew.capture());
                pptxDoc.makeNewSlide().addImage(fileName, {x: 0, y: 0, cx: "100%", cy: "100%"});
                progress(opts, i + 1, frames.length);
            }
        });

        await new Promise((resolve, reject) => {
            const pptxFile = fs.createWriteStream(outPath);
            pptxFile.on("close", resolve);
            pptxFile.on("error", reject);
            pptxDoc.on("error", reject);
            pptxDoc.generate(pptxFile, {
                error: err => reject(err instanceof Error ? err : new Error(`PPTX generation failed: ${err}`))
            });
        });
        return {out: outPath, frames: frames.length, warnings, capture};
    }
    finally {
        removeTmpDir(destDir);
    }
}

/** Remove a temporary directory, ignoring failures.
 *
 * @param {?object} dir - A directory created by `tmp.dirSync`, or `null`.
 */
function removeTmpDir(dir) {
    if (dir) {
        try {
            dir.removeCallback();
        }
        catch (e) {
            // Ignore failures to remove the temporary directory.
        }
    }
}

/** Export a presentation to a video or a PNG image sequence.
 *
 * With format `png`, the images `img000000.png`, `img000001.png`... are written
 * to the output directory (created if needed; earlier images of that pattern are removed).
 * Other formats are encoded by an external ffmpeg (see {@linkcode module:exporter.findFfmpeg|findFfmpeg}).
 *
 * @param {object} presentation - The presentation, or a plain object with the `exportToVideo*` fields and `frames`.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} [opts] - `{outPath, ffmpegPath, hidden, transparent, timeoutMs, onProgress}`; `transparent` applies to PNG sequences only;
 *  `outPath` defaults to the HTML path with the format as extension, or `<name>-sozi-export` for PNG sequences.
 * @returns {Promise<object>} - `{out, format, frames, images, files, ffmpeg, warnings, capture}` (`files` for PNG sequences only).
 */
export function exportToVideo(presentation, htmlPath, opts) {
    return dispatch("exportToVideo", presentation, htmlPath, opts, videoExport);
}

/** Implementation of {@linkcode module:exporter.exportToVideo|exportToVideo} (main process).
 *
 * @param {object} presentation - The presentation settings.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The export options, with defaults.
 * @returns {Promise<object>} - The export result.
 */
async function videoExport(presentation, htmlPath, opts) {
    const format  = presentation.exportToVideoFormat;
    const isPNG   = format === "png";
    const outPath = opts.outPath || (isPNG ?
        htmlPath.replace(/\.sozi\.html$|\.html$/, "-sozi-export") :
        htmlPath.replace(/html$/, format));

    const width  = Number(presentation.exportToVideoWidth);
    const height = Number(presentation.exportToVideoHeight);
    const frameRate = Number(presentation.exportToVideoFrameRate);
    if (!(width > 0 && height > 0 && frameRate > 0)) {
        throw new Error(`invalid video size or frame rate: ${width}x${height} at ${frameRate} fps`);
    }
    if (!presentation.frames.length) {
        throw new Error("no frames selected for export");
    }

    let ffmpegPath = null;
    if (!isPNG) {
        ffmpegPath = findFfmpeg(opts.ffmpegPath);
        if (!ffmpegPath) {
            throw new Error(opts.ffmpegPath ? `ffmpeg not found: ${opts.ffmpegPath}` : "ffmpeg not found");
        }
    }

    const timeline = videoTimeline(presentation.frames, frameRate);
    const total    = timelineImageCount(timeline);

    let destDir = null, destDirName;
    if (isPNG) {
        destDirName = outPath;
        fs.mkdirSync(destDirName, {recursive: true});
        for (const name of fs.readdirSync(destDirName)) {
            if (/^img\d{6}\.png$/.test(name)) {
                fs.unlinkSync(path.join(destDirName, name));
            }
        }
    }
    else {
        destDir = tmp.dirSync({unsafeCleanup: true});
        destDirName = destDir.name;
    }

    const files = [];
    try {
        // Write the next image of the sequence.
        const write = png => {
            const fileName = path.join(destDirName, `img${String(files.length).padStart(6, "0")}.png`);
            fs.writeFileSync(fileName, png);
            files.push(fileName);
            progress(opts, files.length, total);
        };

        const windowOpts = Object.assign({}, opts, {width, height, transparent: isPNG && opts.transparent});
        const {warnings, capture} = await withExportWindow(htmlPath, windowOpts, async ew => {
            for (const step of timeline) {
                if (step.type === "hold") {
                    await ew.jumpToFrame(step.frame);
                    const png = await ew.capture();
                    for (let i = 0; i < step.count; i ++) {
                        write(png);
                    }
                }
                else {
                    await ew.run(`__soziExport.setup(${step.to})`);
                    for (const p of step.progress) {
                        await ew.run(`__soziExport.step(${p})`);
                        await ew.settle();
                        write(await ew.capture());
                    }
                    await ew.run("__soziExport.finish()");
                }
            }
        });

        if (!isPNG) {
            await runFfmpeg(ffmpegPath, [
                "-hide_banner", "-loglevel", "error", "-y",
                "-framerate", String(frameRate),
                "-start_number", "0",
                "-f", "image2",
                "-i", path.join(destDirName, "img%06d.png"),
                // Most codecs require even dimensions with 4:2:0 chroma subsampling.
                "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-pix_fmt", "yuv420p",
                "-b:v", String(presentation.exportToVideoBitRate),
                outPath
            ]);
        }

        const result = {out: outPath, format, frames: presentation.frames.length, images: files.length, ffmpeg: ffmpegPath, warnings, capture};
        if (isPNG) {
            result.files = files;
        }
        return result;
    }
    finally {
        removeTmpDir(destDir);
    }
}

/** The export functions that a renderer can call through {@linkcode module:exporter.runExport|runExport}.
 *
 * @readonly
 * @type {object.<string, Function>}
 */
const exportFunctions = {exportToPDF, exportToPPTX, exportToVideo};
