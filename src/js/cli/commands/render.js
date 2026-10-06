/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The `render` command of `sozi --cli`.
 *
 * Writes a PNG image of one frame, or of every frame, of a presentation,
 * captured from the presentation HTML file at its real path (in the output
 * directory, if any). The HTML file is built first if it is missing or
 * older than the SVG or JSON file, or with `--rebuild`.
 *
 * The capture window is created by the exporter in the main process
 * (see {@linkcode module:exporter.renderFrames|renderFrames}); this command
 * waits for it in the renderer of the command-line mode.
 *
 * @module
 */

import {buildIfNeeded, presentationHtml} from "../html";
import {outputDirError} from "../output";

/** The flags of this command (see {@link module:cli/args.GLOBAL_FLAGS}).
 *
 * @type {{[name: string]: (boolean|string)}}
 */
export const FLAGS = {frame: true, all: false, out: true, rebuild: false, "frame-number": false, "out-dir": true, presentation: true};

/** The default size of the images, as in the `--size` flag.
 *
 * @readonly
 * @default
 * @type {string}
 */
const DEFAULT_SIZE = "1280x720";

/** Parse the `--size` flag.
 *
 * @param {object} flags - The command-line flags.
 * @returns {?{width: number, height: number}} - The image size, or `null` if the flag is invalid.
 */
function parseSize(flags) {
    const match = /^(\d+)x(\d+)$/.exec(flags.size || DEFAULT_SIZE);
    const size  = match && {width: Number(match[1]), height: Number(match[2])};
    return size && size.width > 0 && size.height > 0 ? size : null;
}

/** Check the flags of the `render` command before the presentation is loaded.
 *
 * @param {object} flags - The command-line flags.
 * @returns {?string} - A usage error, or `null`.
 */
export function checkFlags(flags) {
    if (Object.hasOwn(flags, "frame") === !!flags.all) {
        return "render needs either --frame <index|id> or --all";
    }
    if (!Object.hasOwn(flags, "out")) {
        return "render needs --out <file.png> with --frame, or --out <directory> with --all";
    }
    if (!parseSize(flags)) {
        return `invalid --size: ${flags.size}; expected WxH with W and H greater than 0`;
    }
    return null;
}

/** Find a frame by 0-based index or by frame id, as `inspect --frame` does.
 *
 * An index wins over a frame id with the same text.
 *
 * @param {module:model/Presentation.Presentation} presentation - The presentation.
 * @param {string} key - A frame index or id.
 * @returns {number} - The index of the frame, or -1 if not found.
 */
function findFrame(presentation, key) {
    if (/^\d+$/.test(key) && Number(key) < presentation.frames.length) {
        return Number(key);
    }
    return presentation.frames.findIndex(frame => frame.frameId === key);
}

/** Render frames of a presentation that has been loaded to PNG images.
 *
 * With `--frame N|id`, `--out` is the image file (relative to the working
 * directory). With `--all`, `--out` is a directory that receives
 * `frame-000.png`, `frame-001.png`... named after the 0-based frame index;
 * the images are rendered in a temporary directory and moved there once they
 * are all written, then the earlier images of that pattern that were not
 * replaced are removed: a failed render leaves the directory as it was.
 * Directories are created if missing. The images have the `--size` (default
 * 1280x720), with the presentation aspect ratio fitted inside, as in the player.
 * The frame number of the player is hidden unless `--frame-number`.
 *
 * @param {object} context - The command context.
 * @param {module:Controller.Controller} context.controller - The controller.
 * @param {module:Storage.Storage} context.storage - The storage, with the presentation loaded.
 * @param {string} context.svg - The absolute path of the SVG file.
 * @param {string} context.presentation - The absolute path of the JSON file.
 * @param {string} context.cwd - The working directory.
 * @param {object} context.flags - The command-line flags.
 * @param {string[]} context.warnings - Warnings to report; this command may add some.
 * @returns {Promise<object>} - The command result `{ok, files, size, frames: [{index, id, file}], html, rebuilt, capture}`,
 *  or `{ok: false, error, exitCode}` (2 for an unusable output path, 1 for an unknown frame).
 */
export async function render(context) {
    const fs       = require("fs");
    const path     = require("path");
    const exporter = require("../../exporter");
    const {controller, cwd, flags, warnings} = context;
    const frames   = controller.presentation.frames;

    const {html, error} = presentationHtml(context);
    if (error) {
        return {ok: false, error, exitCode: 2};
    }
    const size = parseSize(flags);
    const out  = path.resolve(cwd, flags.out);

    // The frames to render and their image files.
    let images;
    if (flags.all) {
        const bad = outputDirError(out);
        if (bad) {
            return {ok: false, error: `--out ${flags.out}: ${bad} is not a directory`, exitCode: 2};
        }
        if (!frames.length) {
            return {ok: false, error: "the presentation has no frames"};
        }
        const digits = Math.max(3, String(frames.length - 1).length);
        images = frames.map((frame, index) => ({index, file: path.join(out, `frame-${String(index).padStart(digits, "0")}.png`)}));
    }
    else {
        if (fs.existsSync(out) && fs.statSync(out).isDirectory()) {
            return {ok: false, error: `--out ${flags.out}: ${out} is a directory; with --frame, --out names the image file`, exitCode: 2};
        }
        const bad = outputDirError(path.dirname(out));
        if (bad) {
            return {ok: false, error: `--out ${flags.out}: ${bad} is not a directory`, exitCode: 2};
        }
        const index = findFrame(controller.presentation, flags.frame);
        if (index < 0) {
            return {ok: false, error: `frame not found: ${flags.frame}`};
        }
        images = [{index, file: out}];
    }

    // Build the HTML file in this process if needed.
    const built = buildIfNeeded(context, html);
    if (!built.ok) {
        return built;
    }

    const renderOpts = {width: size.width, height: size.height, frameNumber: !!flags["frame-number"]};
    const result = flags.all ?
        await renderAll(exporter, controller.presentation, html, renderOpts, images, out) :
        await exporter.renderFrames(controller.presentation, html, Object.assign({frames: images}, renderOpts));
    warnings.push(...result.warnings);

    return {
        ok:     true,
        files:  images.map(({file}) => file),
        size:   result.size,
        frames: images.map(({index, file}) => ({index, id: frames[index].frameId, file})),
        html,
        rebuilt: built.rebuilt,
        capture: result.capture
    };
}

/** Render every frame into a directory, replacing the earlier images only after success.
 *
 * The images are written to a temporary directory, then moved to their names
 * in `dir`; the earlier `frame-NNN.png` images that were not replaced are removed last.
 *
 * @param {object} exporter - The exporter module.
 * @param {module:model/Presentation.Presentation} presentation - The presentation.
 * @param {string} html - The path of the HTML file.
 * @param {object} opts - The options of `renderFrames`, without `frames`.
 * @param {{index: number, file: string}[]} images - The frames and their final image files in `dir`.
 * @param {string} dir - The directory of the images.
 * @returns {Promise<object>} - The result of `renderFrames`.
 */
async function renderAll(exporter, presentation, html, opts, images, dir) {
    const fs   = require("fs");
    const os   = require("os");
    const path = require("path");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-render-"));
    try {
        const tmpImages = images.map(({index, file}) => ({index, file: path.join(tmpDir, path.basename(file))}));
        const result = await exporter.renderFrames(presentation, html, Object.assign({frames: tmpImages}, opts));

        fs.mkdirSync(dir, {recursive: true});
        const names = new Set(images.map(({file}) => path.basename(file)));
        images.forEach(({file}, i) => moveFile(tmpImages[i].file, file));
        for (const name of fs.readdirSync(dir)) {
            if (/^frame-\d+\.png$/.test(name) && !names.has(name)) {
                fs.unlinkSync(path.join(dir, name));
            }
        }
        return result;
    }
    finally {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    }
}

/** Move a file, also across file systems.
 *
 * @param {string} from - The source file.
 * @param {string} to - The target file, replaced if it exists.
 */
function moveFile(from, to) {
    const fs = require("fs");
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
