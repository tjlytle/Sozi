/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The output directory of the HTML files in `sozi --cli`.
 *
 * Shared by the commands that write, report or store the output directory,
 * so that they agree on the directory and on the error message.
 *
 * @module
 */

import {presentationFiles} from "../naming";

/** Find why a directory cannot be the output directory of the HTML files.
 *
 * The directory may not exist yet (it is created by `build`), but neither it
 * nor any of its existing ancestors may be something else than a directory.
 *
 * @param {string} dir - The absolute path of the directory.
 * @returns {?string} - The path that is not a directory, or `null` if the directory is usable.
 */
export function outputDirError(dir) {
    const fs   = require("fs");
    const path = require("path");

    for (let p = dir; ; p = path.dirname(p)) {
        if (fs.existsSync(p)) {
            return fs.statSync(p).isDirectory() ? null : p;
        }
        if (path.dirname(p) === p) {
            return null;
        }
    }
}

/** Resolve the output directory of the HTML files of a presentation.
 *
 * The `--out-dir` flag (relative to the working directory) wins over the
 * `outputDir` key of the presentation file (relative to its directory);
 * without either, the HTML files go beside the presentation file.
 * The directory is checked with {@link outputDirError}.
 *
 * @param {object} context - The command context.
 * @param {module:Storage.Storage} context.storage - The storage, with the presentation loaded.
 * @param {string} context.svg - The absolute path of the SVG file.
 * @param {string} context.presentation - The absolute path of the JSON file.
 * @param {string} context.cwd - The working directory.
 * @param {object} context.flags - The command-line flags.
 * @returns {{dir: string, source: string, error: ?string}} - The absolute path of the directory,
 *  its source (`"flag"`, `"json"` or `"default"`), and a usage error, or `null`.
 */
export function resolveOutputDir({storage, svg, presentation, cwd, flags}) {
    const path = require("path");

    const flag = flags["out-dir"];
    const key  = storage.presentation.outputDir;
    let dir, source, label;
    if (flag !== undefined) {
        dir    = path.resolve(cwd, flag);
        source = "flag";
        label  = `--out-dir ${flag}`;
    }
    else if (key) {
        dir    = path.resolve(presentationFiles(svg, presentation, {outputDir: key}).outputDir);
        source = "json";
        label  = `outputDir ${key} of ${presentation}`;
    }
    else {
        dir    = path.dirname(presentation);
        source = "default";
        label  = presentation;
    }
    const bad = outputDirError(dir);
    return {dir, source, error: bad ? `${label}: ${bad} is not a directory` : null};
}
