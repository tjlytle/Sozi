/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The `build` command of `sozi --cli`.
 *
 * Writes the presentation HTML, the presenter console HTML and, unless
 * `--no-json` is given, the presentation JSON file.
 *
 * @module
 */

/** Build the HTML files of a presentation that has been loaded.
 *
 * @param {object} context - The command context.
 * @param {module:Storage.Storage} context.storage - The storage, with the presentation loaded.
 * @param {string} context.svg - The absolute path of the SVG file.
 * @param {string} context.presentation - The absolute path of the JSON file.
 * @param {object} context.flags - The command-line flags.
 * @param {string[]} context.warnings - Warnings to report; this command may add some.
 * @returns {{ok: boolean, files: string[], frames: number}} - The command result.
 */
export function build({storage, svg, presentation, flags, warnings}) {
    const fs   = require("fs");
    const path = require("path");

    const base          = svg.replace(/\.[^/.]+$/, "");
    const htmlPath      = base + ".sozi.html";
    const presenterPath = base + "-presenter.sozi.html";

    if (fs.existsSync(htmlPath) && fs.statSync(svg).mtimeMs > fs.statSync(htmlPath).mtimeMs) {
        warnings.push("svg newer than existing html");
    }

    const files = [];
    function write(file, data) {
        fs.writeFileSync(file, data, {encoding: "utf-8"});
        files.push(file);
    }

    write(htmlPath, storage.exportHTML());
    write(presenterPath, storage.exportPresenterHTML(path.basename(htmlPath)));
    if (!flags["no-json"]) {
        write(presentation, storage.getJSONData());
    }

    return {ok: true, files, frames: storage.presentation.frames.length};
}
