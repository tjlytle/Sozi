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

import {build} from "./build";
import {outputDirError, resolveOutputDir} from "../output";
import {presentationFiles} from "../../naming";

/** The flags of this command (see {@link module:cli/args.GLOBAL_FLAGS}).
 *
 * @type {{[name: string]: (boolean|string)}}
 */
export const FLAGS = {frame: true, all: false, out: true, rebuild: false, "out-dir": true, presentation: true};

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

/** Is the HTML file missing, or older than the SVG file or the JSON file?
 *
 * @param {string} html - The path of the HTML file.
 * @param {string[]} sources - The paths of the SVG and JSON files; missing files are ignored.
 * @returns {boolean} - `true` if the HTML file must be built.
 */
function isStale(html, sources) {
    const fs = require("fs");

    if (!fs.existsSync(html)) {
        return true;
    }
    const built = fs.statSync(html).mtimeMs;
    return sources.some(file => fs.existsSync(file) && fs.statSync(file).mtimeMs > built);
}

/** Render frames of a presentation that has been loaded to PNG images.
 *
 * With `--frame N|id`, `--out` is the image file (relative to the working
 * directory). With `--all`, `--out` is a directory that receives
 * `frame-000.png`, `frame-001.png`... named after the 0-based frame index;
 * earlier images of that pattern in the directory are removed.
 * Directories are created if missing. The images have the `--size` (default
 * 1280x720), with the presentation aspect ratio fitted inside, as in the player.
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
    const {controller, svg, presentation, cwd, flags, warnings} = context;
    const frames   = controller.presentation.frames;

    const {dir: outputDir, error} = resolveOutputDir(context);
    if (error) {
        return {ok: false, error, exitCode: 2};
    }
    const html = presentationFiles(svg, presentation, {outputDir}).html;
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
    const rebuilt = !!flags.rebuild || isStale(html, [svg, presentation]);
    if (rebuilt) {
        const buildWarnings = [];
        const built = build(Object.assign({}, context, {warnings: buildWarnings}));
        if (!built.ok) {
            return built;
        }
        // The HTML is rebuilt precisely because it was stale.
        warnings.push(...buildWarnings.filter(w => w !== "svg newer than existing html"));
    }

    if (flags.all && fs.existsSync(out)) {
        for (const name of fs.readdirSync(out)) {
            if (/^frame-\d+\.png$/.test(name)) {
                fs.unlinkSync(path.join(out, name));
            }
        }
    }

    const result = await exporter.renderFrames(controller.presentation, html, {width: size.width, height: size.height, frames: images});
    warnings.push(...result.warnings);

    return {
        ok:     true,
        files:  result.files,
        size:   result.size,
        frames: images.map(({index, file}) => ({index, id: frames[index].frameId, file})),
        html,
        rebuilt,
        capture: result.capture
    };
}
