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

import {applyOptions, FLAGS as setFlags} from "./set";
import {presentationFiles} from "../../naming";

/** The flags of this command (see {@link module:cli/args.GLOBAL_FLAGS}).
 *
 * @type {{[name: string]: (boolean|string)}}
 */
export const FLAGS = {"write-json": false, title: setFlags.title, presentation: true};

/** Does an SVG document contain a relative image or media href?
 *
 * A relative href has no scheme (such as `data:` or `https:`) and does not
 * start with `/` or `#`. The hrefs checked are those of `<image>` elements
 * and `sozi:src` attributes.
 *
 * @param {string} svgText - The content of the SVG file.
 * @returns {boolean} - `true` if a relative href was found.
 */
function hasRelativeHrefs(svgText) {
    const hrefs = [
        ...svgText.matchAll(/<image\b[^>]*?\s(?:[\w.-]+:)?href\s*=\s*(["'])(.*?)\1/gi),
        ...svgText.matchAll(/\ssozi:src\s*=\s*(["'])(.*?)\1/gi)
    ].map(match => match[2].trim());
    return hrefs.some(href => href && !/^[a-z][a-z0-9+.-]*:|^[/#]/i.test(href));
}

/** Build the HTML files of a presentation that has been loaded.
 *
 * The HTML files are named after the presentation file and written beside it.
 * When that is not the directory of the SVG file and the SVG has relative image
 * or media hrefs, a warning says that they will not resolve from the HTML.
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
 * @param {object} context.flags - The command-line flags.
 * @param {string[]} context.warnings - Warnings to report; this command may add some.
 * @returns {{ok: boolean, files: string[], frames: number}} - The command result.
 */
export function build({controller, storage, svg, presentation, flags, warnings}) {
    const fs   = require("fs");
    const path = require("path");

    const {html: htmlPath, presenter: presenterPath} = presentationFiles(svg, presentation);

    if (fs.existsSync(htmlPath) && fs.statSync(svg).mtimeMs > fs.statSync(htmlPath).mtimeMs) {
        warnings.push("svg newer than existing html");
    }
    // Until the output-directory feature rewrites them, the relative hrefs
    // of the SVG are copied unchanged into the HTML.
    if (path.dirname(htmlPath) !== path.dirname(svg) && hasRelativeHrefs(fs.readFileSync(svg, {encoding: "utf-8"}))) {
        warnings.push("html directory differs from the svg directory; " +
            "relative image and media hrefs will not resolve until the output-directory feature lands");
    }

    applyOptions(controller, flags);

    const files = [];
    function write(file, data) {
        fs.writeFileSync(file, data, {encoding: "utf-8"});
        files.push(file);
    }

    write(htmlPath, storage.exportHTML());
    write(presenterPath, storage.exportPresenterHTML(path.basename(htmlPath)));
    if (!fs.existsSync(presentation) || storage.jsonNeedsSaving || flags["write-json"]) {
        write(presentation, storage.getJSONData());
    }

    return {ok: true, files, frames: storage.presentation.frames.length};
}
