/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The `build` command of `sozi --cli`.
 *
 * Writes the presentation HTML, the presenter console HTML and, when needed,
 * the presentation JSON file.
 *
 * @module
 */

import {applyOptions, BUILD_OPTIONS, FLAGS as setFlags} from "./set";
import {resolveOutputDir} from "../output";
import {presentationFiles} from "../../naming";

/** The flags of this command (see {@link module:cli/args.GLOBAL_FLAGS}).
 *
 * @type {{[name: string]: (boolean|string)}}
 */
export const FLAGS = {"write-json": false, title: setFlags.title, "out-dir": true, presentation: true};

/** Build the HTML files of a presentation that has been loaded.
 *
 * The HTML files are named after the presentation file and written beside it,
 * or in the `outputDir` of the presentation, or in the directory given by
 * `--out-dir` (relative to the working directory, for this run only: the key is
 * not changed). The output directory is created if missing; an output directory
 * that is a file is a usage error. When that is
 * not the directory of the SVG file, the relative image and media hrefs are
 * rewritten so that they resolve from the HTML (see `Storage#exportHTML`).
 *
 * The JSON file is written only if it does not exist, if the presentation
 * was changed while loading (`storage.jsonNeedsSaving`), or with `--write-json`.
 * Loading and saving a presentation is not byte-stable (camera coordinates
 * drift slightly), so rewriting it on every build would make spurious changes.
 *
 * `--title` sets the explicit title before writing, like the `set` command;
 * a change of title marks the JSON file as needing to be saved.
 *
 * @param {object} context - The command context.
 * @param {module:Controller.Controller} context.controller - The controller.
 * @param {module:Storage.Storage} context.storage - The storage, with the presentation loaded.
 * @param {string} context.svg - The absolute path of the SVG file.
 * @param {string} context.presentation - The absolute path of the JSON file.
 * @param {string} context.cwd - The working directory.
 * @param {object} context.flags - The command-line flags.
 * @param {string[]} context.warnings - Warnings to report; this command may add some.
 * @returns {{ok: boolean, files: string[], frames: number}} - The command result,
 *  or `{ok: false, error, exitCode: 2}` for an output directory that is a file.
 */
export function build(context) {
    const fs   = require("fs");
    const path = require("path");
    const {controller, storage, svg, presentation, flags, warnings} = context;

    const {dir: outputDir, error} = resolveOutputDir(context);
    if (error) {
        return {ok: false, error, exitCode: 2};
    }
    const {html: htmlPath, presenter: presenterPath} = presentationFiles(svg, presentation, {outputDir});

    if (fs.existsSync(htmlPath) && fs.statSync(svg).mtimeMs > fs.statSync(htmlPath).mtimeMs) {
        warnings.push("svg newer than existing html");
    }

    applyOptions(controller, flags, context, BUILD_OPTIONS);

    // The JSON file is written first: the HTML files are then never older than it,
    // so that `render` and `export` do not take them for stale. It is reported last.
    const writeJSON = !fs.existsSync(presentation) || storage.jsonNeedsSaving || flags["write-json"];
    if (writeJSON) {
        fs.writeFileSync(presentation, storage.getJSONData(), {encoding: "utf-8"});
    }
    fs.mkdirSync(outputDir, {recursive: true});
    fs.writeFileSync(htmlPath, storage.exportHTML(outputDir), {encoding: "utf-8"});
    fs.writeFileSync(presenterPath, storage.exportPresenterHTML(path.basename(htmlPath)), {encoding: "utf-8"});

    const files = writeJSON ? [htmlPath, presenterPath, presentation] : [htmlPath, presenterPath];
    return {ok: true, files, frames: storage.presentation.frames.length};
}
