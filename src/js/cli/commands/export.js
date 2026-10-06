/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The `export` command of `sozi --cli`.
 *
 * Exports a presentation to PDF, PPTX, a video or a PNG image sequence, with
 * the export settings of the presentation file, overridden by the flags for
 * this run only (the presentation file is not changed). The export captures
 * the presentation HTML file at its real path, built first if needed as for
 * `render` (see {@linkcode module:cli/html.buildIfNeeded|buildIfNeeded}).
 *
 * The export type is chosen with `--export-type`: Chromium reserves `--type`
 * for its own processes, so the Electron binary never runs with it.
 *
 * @module
 */

import {DEFAULT_TIMEOUT_S} from "../args";
import {buildIfNeeded, presentationHtml} from "../html";
import {outputDirError} from "../output";

/** The flags of this command (see {@link module:cli/args.GLOBAL_FLAGS}).
 *
 * @type {{[name: string]: (boolean|string)}}
 */
export const FLAGS = {
    "export-type": true,
    format: true,
    fps: true,
    width: true,
    height: true,
    bitrate: true,
    include: "maybe-empty",
    exclude: "maybe-empty",
    ffmpeg: true,
    out: true,
    transparent: false,
    "frame-number": false,
    rebuild: false,
    "out-dir": true,
    presentation: true
};

/** The export types.
 *
 * @readonly
 * @type {string[]}
 */
const TYPES = ["pdf", "pptx", "video"];

/** The video formats; `png` is an image sequence.
 *
 * @readonly
 * @type {string[]}
 */
const FORMATS = ["mp4", "webm", "ogv", "png"];

/** The flags that only apply to video exports.
 *
 * @readonly
 * @type {string[]}
 */
const VIDEO_FLAGS = ["format", "fps", "width", "height", "bitrate", "ffmpeg"];

/** An interval of the frame-list grammar: `N`, `first:last` or `first:second:last`, each number optional.
 *
 * @readonly
 * @type {RegExp}
 */
const INTERVAL = /^\s*\d*\s*(:\s*\d*\s*){0,2}$/;

/** Is an expression valid in the frame-list grammar of the exporter?
 *
 * @param {string} expr - A list of frames, e.g. `1,3:5` or `all`.
 * @returns {boolean} - `true` if the expression is valid.
 */
function isFrameList(expr) {
    return /^\s*(all|none)\s*$/.test(expr) || expr.split(",").every(interval => INTERVAL.test(interval));
}

/** Check the value of the numeric flags.
 *
 * @param {object} flags - The command-line flags.
 * @returns {?string} - A usage error, or `null`.
 */
function checkValues(flags) {
    for (const name of ["width", "height", "bitrate"]) {
        if (Object.hasOwn(flags, name) && !(/^\d+$/.test(flags[name]) && Number(flags[name]) > 0)) {
            return `invalid --${name}: ${flags[name]}; expected a whole number greater than 0`;
        }
    }
    if (Object.hasOwn(flags, "fps") && !(/^\d+(\.\d+)?$/.test(flags.fps) && Number(flags.fps) > 0)) {
        return `invalid --fps: ${flags.fps}; expected a number of images per second greater than 0`;
    }
    for (const name of ["include", "exclude"]) {
        if (Object.hasOwn(flags, name) && !isFrameList(flags[name])) {
            return `invalid --${name}: ${flags[name]}; expected frame numbers and ranges from 1, e.g. 1,3:5 or 2::10, or all, or none`;
        }
    }
    return null;
}

/** Check that the flags apply to an export type and format.
 *
 * @param {object} flags - The command-line flags.
 * @param {?string} type - The export type, or `null` if not known yet.
 * @param {?string} format - The video format, or `null` if not known yet.
 * @returns {?string} - A usage error, or `null`.
 */
function checkApplicable(flags, type, format) {
    if (type && type !== "video") {
        const flag = VIDEO_FLAGS.find(name => Object.hasOwn(flags, name));
        if (flag) {
            return `--${flag} applies to video exports; add --export-type video`;
        }
    }
    if (type === "video") {
        const flag = ["include", "exclude"].find(name => Object.hasOwn(flags, name));
        if (flag) {
            return `--${flag} applies to pdf and pptx exports; a video shows every frame`;
        }
    }
    if (flags.transparent && ((type && type !== "video") || (format && format !== "png"))) {
        return "--transparent applies to png image sequences (--export-type video --format png)";
    }
    return null;
}

/** Check the flags of the `export` command before the presentation is loaded.
 *
 * @param {object} flags - The command-line flags.
 * @returns {?string} - A usage error, or `null`.
 */
export function checkFlags(flags) {
    if (Object.hasOwn(flags, "size")) {
        return "--size does not apply to export; the export settings give the size (use --width and --height for a video)";
    }
    const type = flags["export-type"];
    if (type !== undefined && !TYPES.includes(type)) {
        return `invalid --export-type: ${type}; expected ${TYPES.join(", ")}`;
    }
    if (flags.format !== undefined && !FORMATS.includes(flags.format)) {
        return `invalid --format: ${flags.format}; expected ${FORMATS.join(", ")}`;
    }
    return checkValues(flags) || checkApplicable(flags, type || null, flags.format || null);
}

/** Copy the export settings of a presentation with the flags of this run applied.
 *
 * @param {object} exporter - The exporter module.
 * @param {module:model/Presentation.Presentation} presentation - The presentation.
 * @param {string} type - The export type.
 * @param {string} format - The video format.
 * @param {object} flags - The command-line flags.
 * @returns {object} - The settings to pass to the exporter.
 */
function exportSettings(exporter, presentation, type, format, flags) {
    const settings = exporter.exportSettings(presentation);
    const set = (flag, key, convert = String) => {
        if (Object.hasOwn(flags, flag)) {
            settings[key] = convert(flags[flag]);
        }
    };
    if (type === "pdf") {
        set("include", "exportToPDFInclude");
        set("exclude", "exportToPDFExclude");
    }
    else if (type === "pptx") {
        set("include", "exportToPPTXInclude");
        set("exclude", "exportToPPTXExclude");
    }
    else {
        settings.exportToVideoFormat = format;
        set("fps",     "exportToVideoFrameRate", Number);
        set("width",   "exportToVideoWidth",     Number);
        set("height",  "exportToVideoHeight",    Number);
        set("bitrate", "exportToVideoBitRate",   Number);
    }
    return settings;
}

/** Export a presentation that has been loaded.
 *
 * The type is `--export-type`, else the `exportType` of the presentation file.
 * `--out` (relative to the working directory) is the output file, or the
 * directory of a PNG sequence; by default the output goes beside the HTML
 * file, as in the editor. Missing directories are created. A video other than
 * a PNG sequence needs ffmpeg: `--ffmpeg`, else `ffmpeg` on the `PATH`, else
 * the one bundled with Sozi; it is looked up before anything is built or
 * captured, and its run is bounded by `--timeout` (default 120 s).
 *
 * @param {object} context - The command context.
 * @param {module:Controller.Controller} context.controller - The controller.
 * @param {module:Storage.Storage} context.storage - The storage, with the presentation loaded.
 * @param {string} context.svg - The absolute path of the SVG file.
 * @param {string} context.presentation - The absolute path of the JSON file.
 * @param {string} context.cwd - The working directory.
 * @param {object} context.flags - The command-line flags.
 * @param {string[]} context.warnings - Warnings to report; this command may add some.
 * @returns {Promise<object>} - The command result `{ok, type, format, out, frames, ffmpeg, html, rebuilt, capture}`,
 *  with `images` for videos and `files` for PNG sequences, or `{ok: false, error, exitCode}`
 *  (2 for a usage error or an unusable output path, 1 for other failures).
 */
export async function exportPresentation(context) {
    const fs       = require("fs");
    const path     = require("path");
    const exporter = require("../../exporter");
    const {controller, cwd, flags, warnings} = context;
    const presentation = controller.presentation;

    const type = flags["export-type"] || presentation.exportType || "pdf";
    if (!TYPES.includes(type)) {
        return {ok: false, error: `invalid exportType in the presentation file: ${type}; expected ${TYPES.join(", ")}`};
    }
    const format = type === "video" ? flags.format || presentation.exportToVideoFormat : type;
    if (type === "video" && !FORMATS.includes(format)) {
        return {ok: false, type, error: `invalid exportToVideoFormat in the presentation file: ${format}; expected ${FORMATS.join(", ")}`};
    }
    const fields = {type, format, ffmpeg: null};
    const usage = checkApplicable(flags, type, format);
    if (usage) {
        return Object.assign(fields, {ok: false, error: usage, exitCode: 2});
    }

    const {html, error} = presentationHtml(context);
    if (error) {
        return Object.assign(fields, {ok: false, error, exitCode: 2});
    }

    // The output path: a file, or the directory of a PNG sequence.
    const out = Object.hasOwn(flags, "out") ? path.resolve(cwd, flags.out) : null;
    const isSequence = format === "png";
    if (out) {
        const ext = path.extname(out).slice(1).toLowerCase();
        if (!isSequence && ext !== format) {
            const what  = type === "video" ? "video format" : "export type";
            const given = ext ? `the extension .${ext}` : "no extension";
            return Object.assign(fields, {ok: false, error: `--out ${flags.out} has ${given}, which does not match the ${what} ${format}; use a .${format} file`, exitCode: 2});
        }
        if (!isSequence && fs.existsSync(out) && fs.statSync(out).isDirectory()) {
            return Object.assign(fields, {ok: false, error: `--out ${flags.out}: ${out} is a directory; --out names the ${format} file`, exitCode: 2});
        }
        const bad = outputDirError(isSequence ? out : path.dirname(out));
        if (bad) {
            return Object.assign(fields, {ok: false, error: `--out ${flags.out}: ${bad} is not a directory`, exitCode: 2});
        }
    }

    // ffmpeg is found before anything is written.
    if (type === "video" && !isSequence) {
        const explicit = Object.hasOwn(flags, "ffmpeg") ? path.resolve(cwd, flags.ffmpeg) : null;
        fields.ffmpeg = exporter.findFfmpeg(explicit);
        if (!fields.ffmpeg) {
            return Object.assign(fields, {ok: false, error: explicit ? `ffmpeg not found: ${explicit}` : "ffmpeg not found"});
        }
    }

    const built = buildIfNeeded(context, html);
    if (!built.ok) {
        return Object.assign(fields, built);
    }
    if (out && !isSequence) {
        fs.mkdirSync(path.dirname(out), {recursive: true});
    }

    const settings = exportSettings(exporter, presentation, type, format, flags);
    const opts = {
        outPath:         out,
        ffmpegPath:      fields.ffmpeg,
        transparent:     !!flags.transparent,
        frameNumber:     !!flags["frame-number"],
        ffmpegTimeoutMs: Number(flags.timeout || DEFAULT_TIMEOUT_S) * 1000
    };
    const run = {pdf: exporter.exportToPDF, pptx: exporter.exportToPPTX, video: exporter.exportToVideo}[type];
    let result;
    try {
        result = await run(settings, html, opts);
    }
    catch (err) {
        return Object.assign(fields, {ok: false, error: err && err.message || String(err), html, rebuilt: built.rebuilt});
    }
    warnings.push(...result.warnings);

    const commandResult = Object.assign(fields, {
        ok:      true,
        out:     result.out,
        frames:  result.frames,
        html,
        rebuilt: built.rebuilt,
        capture: result.capture
    });
    if (type === "video") {
        commandResult.images = result.images;
    }
    if (result.files) {
        commandResult.files = result.files;
    }
    return commandResult;
}
