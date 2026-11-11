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
 * This module holds the public functions and the dispatch to the main process;
 * each job lives in its own module of this directory, and this module re-exports
 * the helpers that callers and tests use.
 *
 * @module
 */

import process from "process";
import {exportSettings} from "./frames.js";
import {withDefaults} from "./options.js";
import {pdfExport} from "./pdf.js";
import {pptxExport} from "./pptx.js";
import {videoExport} from "./video.js";
import {frameRender} from "./render.js";

export {selectFrames, exportSettings, videoTimeline, timelineImageCount} from "./frames.js";
export {findFfmpeg, defaultFfmpegTimeoutMs} from "./ffmpeg.js";
export {partialPath, moveFile, linkOrCopy} from "./files.js";
export {ExportWindow} from "./ExportWindow.js";
export {openExportWindow} from "./capture-window.js";

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

/** The export functions that a renderer can call through {@linkcode module:exporter.runExport|runExport}.
 *
 * @readonly
 * @type {{[name: string]: Function}}
 */
const exportFunctions = {exportToPDF, exportToPPTX, exportToVideo, renderFrames};
