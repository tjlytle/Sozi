/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The presentation HTML file captured by `render` and `export` in `sozi --cli`.
 *
 * Both commands capture the built HTML file at its real path (in the output
 * directory, if any), and build it first in the same process when it is
 * missing or older than the SVG or JSON file, or with `--rebuild`.
 *
 * @module
 */

import {build} from "./commands/build";
import {resolveOutputDir} from "./output";
import {presentationFiles} from "../naming";

/** Find the presentation HTML file of a command.
 *
 * @param {object} context - The command context (see {@linkcode module:cli/output.resolveOutputDir|resolveOutputDir}).
 * @returns {{html: ?string, error: ?string}} - The absolute path of the HTML file, or a usage error.
 */
export function presentationHtml(context) {
    const {dir: outputDir, error} = resolveOutputDir(context);
    if (error) {
        return {html: null, error};
    }
    return {html: presentationFiles(context.svg, context.presentation, {outputDir}).html, error: null};
}

/** Is the HTML file missing, or older than the SVG file or the JSON file?
 *
 * @param {string} html - The path of the HTML file.
 * @param {string[]} sources - The paths of the SVG and JSON files; missing files are ignored.
 * @returns {boolean} - `true` if the HTML file must be built.
 */
export function isStale(html, sources) {
    const fs = require("fs");

    if (!fs.existsSync(html)) {
        return true;
    }
    const built = fs.statSync(html).mtimeMs;
    return sources.some(file => fs.existsSync(file) && fs.statSync(file).mtimeMs > built);
}

/** Build the HTML files of a command if needed, like `build`.
 *
 * The HTML file is built when it is missing or stale (see {@link isStale}), or with `--rebuild`.
 * A build may also write the JSON file (see {@linkcode module:cli/commands/build.build|build}).
 *
 * @param {object} context - The command context.
 * @param {string} html - The path of the HTML file.
 * @returns {object} - `{ok: true, rebuilt}`, or the failed result of the build.
 */
export function buildIfNeeded(context, html) {
    const {svg, presentation, flags, warnings} = context;

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
    return {ok: true, rebuilt};
}
