/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Export a presentation to PDF, PPTX, video or a PNG sequence, or render frames to PNG images.
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

import {BrowserWindow, nativeImage} from "electron";
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

/** The default time limit of an ffmpeg run, in milliseconds.
 *
 * Ten minutes, plus 100 ms per image to encode, so that long videos are not
 * stopped (ffmpeg encodes from about 10 to 100 images per second).
 *
 * @param {number} imageCount - The number of images to encode.
 * @returns {number} - The time limit, in milliseconds.
 */
export function defaultFfmpegTimeoutMs(imageCount) {
    return 10 * 60 * 1000 + 100 * imageCount;
}

/** Run a clean-up function when this process exits before the export ends.
 *
 * A command line that times out exits at once: this keeps the captured
 * images and partial output files from staying behind.
 *
 * @param {Function} fn - The clean-up function; its errors are ignored.
 * @returns {Function} - Call it to cancel the clean-up.
 */
function cleanUpOnExit(fn) {
    const cleanUp = () => {
        try {
            fn();
        }
        catch (e) {
            // Nothing more can be done while exiting.
        }
    };
    process.on("exit", cleanUp);
    return () => process.removeListener("exit", cleanUp);
}

/** Remove a directory when this process exits before the export ends.
 *
 * @param {string} dir - The directory to remove.
 * @returns {Function} - Call it to cancel the removal.
 */
function removeOnExit(dir) {
    return cleanUpOnExit(() => fs.rmSync(dir, {recursive: true, force: true}));
}

/** Remove the directories created by `fs.mkdirSync(dir, {recursive: true})` if they are empty.
 *
 * @param {string} dir - The directory given to `mkdirSync`.
 * @param {?string} created - The first directory created, as returned by `mkdirSync`, or `undefined`.
 */
function removeCreatedDirs(dir, created) {
    if (!created) {
        return;
    }
    for (let d = path.resolve(dir); ; d = path.dirname(d)) {
        try {
            fs.rmdirSync(d);
        }
        catch (e) {
            // Not empty, or already gone: keep it and its parents.
            return;
        }
        if (d === path.resolve(created) || d === path.dirname(d)) {
            return;
        }
    }
}

/** The name of the partial file written before an output file is complete.
 *
 * @param {string} outPath - The output file, e.g. `dir/talk.webm`.
 * @returns {string} - The partial file in the same directory, e.g. `dir/.talk.partial.webm`.
 */
export function partialPath(outPath) {
    const ext = path.extname(outPath);
    return path.join(path.dirname(outPath), `.${path.basename(outPath, ext)}.partial${ext}`);
}

/** Write an output file without replacing the previous one before success.
 *
 * The missing directories of the file are created, then `write` writes a
 * partial file in the same directory, which is renamed to `outPath` once it
 * is complete. On failure, or if this process exits first, the partial file
 * and the directories created here are removed: the previous output stays as it was.
 *
 * @param {string} outPath - The output file.
 * @param {function(string):Promise} write - Writes the file at the path it is given.
 * @returns {Promise} - Resolved once `outPath` is complete.
 */
async function writeOutput(outPath, write) {
    const dir     = path.dirname(outPath);
    const created = fs.mkdirSync(dir, {recursive: true});
    const partial = partialPath(outPath);
    const cleanUp = () => {
        fs.rmSync(partial, {force: true});
        removeCreatedDirs(dir, created);
    };
    const cancelCleanUp = cleanUpOnExit(cleanUp);
    try {
        await write(partial);
        fs.renameSync(partial, outPath);
    }
    catch (err) {
        try {
            cleanUp();
        }
        catch (e) {
            // Report the error of the export, not of the clean-up.
        }
        throw err;
    }
    finally {
        cancelCleanUp();
    }
}

/** Move a file, also across file systems.
 *
 * @param {string} from - The source file.
 * @param {string} to - The target file, replaced if it exists.
 */
export function moveFile(from, to) {
    try {
        fs.renameSync(from, to);
    }
    catch (err) {
        if (err.code !== "EXDEV") {
            throw err;
        }
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
    }
}

/** Make a file a hard link of another one, or a copy if the link fails.
 *
 * A copy is always a correct result: links fail across file systems (EXDEV),
 * on file systems without hard links (ENOTSUP, EOPNOTSUPP, EPERM: FAT, exFAT,
 * some network and FUSE mounts) and beyond the link count limit (EMLINK).
 *
 * @param {string} from - The existing file.
 * @param {string} to - The new file.
 */
export function linkOrCopy(from, to) {
    try {
        fs.linkSync(from, to);
    }
    catch (err) {
        fs.copyFileSync(from, to);
    }
}

/** Run ffmpeg and wait for it to terminate.
 *
 * ffmpeg is killed if it runs longer than `timeoutMs`, and when this process
 * exits (e.g. when the command line times out), so that it never outlives the export.
 *
 * @param {string} ffmpegPath - The ffmpeg executable.
 * @param {string[]} args - The command-line arguments.
 * @param {number} [timeoutMs] - The time limit, in milliseconds.
 * @returns {Promise} - Resolved when ffmpeg succeeds; rejected with its status and the end of its standard error otherwise.
 */
function runFfmpeg(ffmpegPath, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        let stderr = "";
        let timedOut = false;
        const child = spawn(ffmpegPath, args, {stdio: ["ignore", "ignore", "pipe"]});
        const kill = () => {
            try {
                child.kill("SIGKILL");
            }
            catch (e) {
                // The process is already gone.
            }
        };
        const timer = setTimeout(() => {
            timedOut = true;
            kill();
        }, Math.min(timeoutMs, 2 ** 31 - 1));
        // Before the other exit handlers, which remove the files that ffmpeg writes.
        process.prependListener("exit", kill);
        const done = () => {
            clearTimeout(timer);
            process.removeListener("exit", kill);
        };
        child.stderr.on("data", chunk => {
            // Keep the end of the output, where ffmpeg explains failures.
            stderr = (stderr + chunk).slice(-4000);
        });
        child.on("error", err => {
            done();
            reject(new Error(`could not run ${ffmpegPath}: ${err.message}`));
        });
        child.on("close", (code, signal) => {
            done();
            if (timedOut) {
                const tail = stderr.trim();
                reject(new Error(`ffmpeg did not finish within ${timeoutMs / 1000} s and was stopped` + (tail ? `: ${tail}` : "")));
            }
            else if (code === 0) {
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

/** Are two images uniform, of the same colour?
 *
 * @param {Electron.NativeImage} a - An image.
 * @param {Electron.NativeImage} b - Another image.
 * @returns {boolean} - `true` if both images are uniform with the same pixel value.
 */
function sameUniformColour(a, b) {
    return !b.isEmpty() && isUniform(a) && isUniform(b) &&
        a.toBitmap().readUInt32LE(0) === b.toBitmap().readUInt32LE(0);
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

        /** Has the Chrome DevTools Protocol confirmed a uniform `capturePage` image?
         *
         * Then later uniform images are believed without checking again.
         *
         * @type {boolean}
         */
        this.capturePageVerified = false;

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
        // If the kick fails, the screenshot is not awaited: never leave its rejection unhandled.
        shot.catch(() => {});
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
     * Uses `capturePage`. On a high-density display, where `capturePage` returns
     * device pixels, an image that is exactly an integer multiple of the requested
     * size is scaled down. It falls back to the Chrome DevTools Protocol (at device
     * scale 1) if the image is empty, has another size, or is uniform while the SVG
     * has visible content, even after waiting for a paint.
     *
     * @returns {Promise<Buffer>} - A PNG image of exactly the requested size.
     */
    async capture() {
        let png;
        if (!this.useCDP) {
            let img = await this.bounded(this.window.webContents.capturePage(), "capturePage");
            if (!img.isEmpty() && isUniform(img) && await this.svgHasContent()) {
                // The first capture of a hidden window can come before its first
                // paint (a uniform image, usually black): wait for a paint and capture again once.
                await this.settle();
                img = await this.bounded(this.window.webContents.capturePage(), "capturePage");
            }
            let size = img.getSize();
            const scale = size.width / this.size.width;
            if (!img.isEmpty() && Number.isInteger(scale) && scale > 1 && size.height === scale * this.size.height) {
                // On a high-density display, capturePage returns device pixels: scale them down.
                img  = img.resize({width: this.size.width, height: this.size.height, quality: "best"});
                size = img.getSize();
            }
            if (img.isEmpty()) {
                this.useCDP = true;
                this.warnings.push("capturePage returned an empty image; captured with the Chrome DevTools Protocol (Page.captureScreenshot) instead");
            }
            else if (size.width !== this.size.width || size.height !== this.size.height) {
                // Device pixels at a fractional scale factor, or a window clamped to the screen.
                this.useCDP = true;
                this.warnings.push(`capturePage returned a ${size.width}x${size.height} image (display scale factor?); captured with the Chrome DevTools Protocol at device scale 1 instead`);
            }
            else if (isUniform(img) && !this.capturePageVerified && await this.svgHasContent()) {
                // A frame can be all one colour (e.g. inside a filled shape): believe
                // capturePage if the Chrome DevTools Protocol shows the same colour.
                // A blank capturePage is a failure of the window, so one confirmation is enough.
                const cdpPng = await this.captureCDP();
                if (sameUniformColour(img, nativeImage.createFromBuffer(cdpPng))) {
                    this.capturePageVerified = true;
                    png = img.toPNG();
                    this.captureMethods.add("capturePage");
                }
                else {
                    png = cdpPng;
                    this.captureMethods.add("cdp");
                    this.useCDP = true;
                    this.warnings.push("capturePage returned a uniform image of a non-empty SVG; captured with the Chrome DevTools Protocol (Page.captureScreenshot) instead");
                }
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
 * The promise resolves when the player is ready, with media disabled and,
 * unless `frameNumber` is true, the frame number of the player hidden.
 * Each step is bounded by `timeoutMs` (default 30 s); on failure the window is destroyed.
 *
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - `{width, height, hidden, transparent, frameNumber, timeoutMs}`.
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
    // The capture window shows the presentation only: no link may navigate away or open a window.
    w.webContents.on("will-navigate", event => event.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({action: "deny"}));
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
            // The player sets the visibility of the frame number at each frame change, not its display.
            const frameNumber = document.querySelector(".sozi-frame-number");
            if (frameNumber && ${!opts.frameNumber}) {
                frameNumber.style.display = "none";
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
        frameNumber: false,
        timeoutMs  : DEFAULT_TIMEOUT_MS,
        ffmpegTimeoutMs: null,
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
 * @param {object} [opts] - `{outPath, hidden, frameNumber, timeoutMs, onProgress}`; `outPath` defaults to the HTML path with a `.pdf` extension.
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

    const {value: pdfBytes, warnings} = await withExportWindow(htmlPath, Object.assign({}, opts, g, {transparent: false}), async ew => {
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
        return pdfDoc.save();
    });
    await writeOutput(outPath, partial => fs.writeFileSync(partial, pdfBytes));
    return {out: outPath, frames: frames.length, warnings, capture: "printToPDF"};
}

/** Export a presentation to a PPTX document.
 *
 * @param {object} presentation - The presentation, or a plain object with the `exportToPPTX*` fields and `frames`.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} [opts] - `{outPath, hidden, frameNumber, timeoutMs, onProgress}`; `outPath` defaults to the HTML path with a `.pptx` extension.
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
    const cancelRemoval = removeOnExit(destDir.name);
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

        await writeOutput(outPath, partial => new Promise((resolve, reject) => {
            const pptxFile = fs.createWriteStream(partial);
            pptxFile.on("close", resolve);
            pptxFile.on("error", reject);
            pptxDoc.on("error", reject);
            pptxDoc.generate(pptxFile, {
                error: err => reject(err instanceof Error ? err : new Error(`PPTX generation failed: ${err}`))
            });
        }));
        return {out: outPath, frames: frames.length, warnings, capture};
    }
    finally {
        cancelRemoval();
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

/** The video formats of the export: the extension of the video file, or `png` for an image sequence.
 *
 * @readonly
 * @type {string[]}
 */
const VIDEO_FORMATS = ["mp4", "ogv", "webm", "wmv", "png"];

/** Export a presentation to a video or a PNG image sequence.
 *
 * With format `png`, the images `img000000.png`, `img000001.png`... are written
 * to the output directory (created if needed). They are captured in a temporary
 * directory and moved there once they are all written; then the earlier images
 * of that pattern that were not replaced are removed: a failed export leaves the
 * directory as it was. Other formats are encoded by an external ffmpeg (see
 * {@linkcode module:exporter.findFfmpeg|findFfmpeg}) to a partial file renamed to
 * the output file on success. The images of a frame held for several time steps
 * are hard links of one file where the file system allows it.
 *
 * @param {object} presentation - The presentation, or a plain object with the `exportToVideo*` fields and `frames`.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} [opts] - `{outPath, ffmpegPath, hidden, transparent, frameNumber, timeoutMs, ffmpegTimeoutMs, onProgress}`;
 *  `transparent` applies to PNG sequences only; `ffmpegTimeoutMs` bounds the encoding
 *  (default {@linkcode module:exporter.defaultFfmpegTimeoutMs|defaultFfmpegTimeoutMs} of the image count);
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
    if (!VIDEO_FORMATS.includes(format)) {
        throw new Error(`unknown video format: ${format}; expected ${VIDEO_FORMATS.join(", ")}`);
    }
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

    // The images are captured in a temporary directory, deleted even if not empty.
    const destDir = tmp.dirSync({unsafeCleanup: true});
    const cancelRemoval = removeOnExit(destDir.name);

    const files = [];
    try {
        // Write the next image of the sequence, or link it to an earlier image with the same content.
        const write = (png, sameAs = null) => {
            const fileName = path.join(destDir.name, `img${String(files.length).padStart(6, "0")}.png`);
            if (sameAs) {
                linkOrCopy(sameAs, fileName);
            }
            else {
                fs.writeFileSync(fileName, png);
            }
            files.push(fileName);
            progress(opts, files.length, total);
            return fileName;
        };

        const windowOpts = Object.assign({}, opts, {width, height, transparent: isPNG && opts.transparent});
        const {warnings, capture} = await withExportWindow(htmlPath, windowOpts, async ew => {
            for (const step of timeline) {
                if (step.type === "hold") {
                    await ew.jumpToFrame(step.frame);
                    const first = write(await ew.capture());
                    for (let i = 1; i < step.count; i ++) {
                        write(null, first);
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

        const result = {out: outPath, format, frames: presentation.frames.length, images: files.length, ffmpeg: ffmpegPath, warnings, capture};
        if (isPNG) {
            result.files = moveSequence(files, outPath);
        }
        else {
            const ffmpegTimeoutMs = opts.ffmpegTimeoutMs > 0 ? opts.ffmpegTimeoutMs : defaultFfmpegTimeoutMs(total);
            await writeOutput(outPath, partial => runFfmpeg(ffmpegPath, [
                "-hide_banner", "-loglevel", "error", "-y",
                "-framerate", String(frameRate),
                "-start_number", "0",
                "-f", "image2",
                "-i", path.join(destDir.name, "img%06d.png"),
                // Most codecs require even dimensions with 4:2:0 chroma subsampling.
                "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-pix_fmt", "yuv420p",
                "-b:v", String(presentation.exportToVideoBitRate),
                partial
            ], ffmpegTimeoutMs));
        }
        return result;
    }
    finally {
        cancelRemoval();
        removeTmpDir(destDir);
    }
}

/** Move the images of a PNG sequence into the output directory, then remove the earlier images.
 *
 * The directory is created if needed. Images that were hard links of one file
 * stay hard links of one file when the move copies them to another file system.
 * The earlier `img000000.png`... images that were not replaced are removed last;
 * other files are kept.
 *
 * @param {string[]} files - The images, in a temporary directory.
 * @param {string} dir - The output directory.
 * @returns {string[]} - The images in the output directory.
 */
function moveSequence(files, dir) {
    fs.mkdirSync(dir, {recursive: true});
    const moved  = new Map(); // inode -> the image already moved to the output directory
    const result = files.map(file => {
        const target = path.join(dir, path.basename(file));
        const {ino} = fs.statSync(file);
        if (moved.has(ino)) {
            // Replace an earlier image first: a link cannot overwrite a file.
            fs.rmSync(target, {force: true});
            linkOrCopy(moved.get(ino), target);
            fs.unlinkSync(file);
        }
        else {
            moveFile(file, target);
            moved.set(ino, target);
        }
        return target;
    });
    const names = new Set(result.map(file => path.basename(file)));
    for (const name of fs.readdirSync(dir)) {
        if (/^img\d{6}\.png$/.test(name) && !names.has(name)) {
            fs.unlinkSync(path.join(dir, name));
        }
    }
    return result;
}

/** Render frames of a presentation to PNG images, one image per frame.
 *
 * Each frame is shown without transition and captured at exactly the
 * requested size; the player fits the presentation aspect ratio inside it.
 * The directories of the image files are created if needed.
 *
 * @param {object} presentation - The presentation, or a plain object with `frames`.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - `{width, height, frames: [{index, file}], tempDir, hidden, frameNumber, timeoutMs, onProgress}`,
 *  where `index` is the 0-based index of a frame and `file` the path of its image;
 *  `tempDir`, if given, is a directory of the caller removed if this process exits during the render.
 * @returns {Promise<object>} - `{files, size: {width, height}, warnings, capture}`.
 */
export function renderFrames(presentation, htmlPath, opts) {
    return dispatch("renderFrames", presentation, htmlPath, opts, frameRender);
}

/** Implementation of {@linkcode module:exporter.renderFrames|renderFrames} (main process).
 *
 * @param {object} presentation - The presentation settings.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The render options, with defaults.
 * @returns {Promise<object>} - The render result.
 */
async function frameRender(presentation, htmlPath, opts) {
    const width  = Number(opts.width);
    const height = Number(opts.height);
    if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
        throw new Error(`invalid image size: ${opts.width}x${opts.height}`);
    }
    const images = opts.frames || [];
    if (!images.length) {
        throw new Error("no frames selected for export");
    }
    for (const {index} of images) {
        if (!(Number.isInteger(index) && index >= 0 && index < presentation.frames.length)) {
            throw new Error(`frame index out of range: ${index}`);
        }
    }

    const files = [];
    const windowOpts = Object.assign({}, opts, {width, height, transparent: false});
    const cancelRemoval = opts.tempDir ? removeOnExit(opts.tempDir) : () => {};
    try {
        const {warnings, capture} = await withExportWindow(htmlPath, windowOpts, async ew => {
            for (const {index, file} of images) {
                await ew.jumpToFrame(index);
                const png = await ew.capture();
                fs.mkdirSync(path.dirname(file), {recursive: true});
                fs.writeFileSync(file, png);
                files.push(file);
                progress(opts, files.length, images.length);
            }
        });
        return {files, size: {width, height}, warnings, capture};
    }
    finally {
        cancelRemoval();
    }
}

/** The export functions that a renderer can call through {@linkcode module:exporter.runExport|runExport}.
 *
 * @readonly
 * @type {object.<string, Function>}
 */
const exportFunctions = {exportToPDF, exportToPPTX, exportToVideo, renderFrames};
