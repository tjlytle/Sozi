/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The names of the files of a presentation.
 *
 * This module depends only on `path` so that it can be used by the editor,
 * the command-line mode and unit tests alike.
 *
 * @module
 */

import path from "path";

/** Replace the extension in a file name.
 *
 * @param {string} fileName - The name of a file.
 * @param {string} ext - The new extension.
 * @returns {string} - A file name with the new extension.
 */
export function replaceFileExtWith(fileName, ext) {
    return fileName.replace(/\.[^/.]+$/, ext);
}

/** The extension of presentation files. */
const PRESENTATION_EXT = ".sozi.json";

/** Is a file a presentation file?
 *
 * Only a file whose name ends in `.sozi.json`, in any letter case, is a
 * presentation file; another `.json` file is not.
 *
 * @param {string} fileName - The name or path of a file.
 * @returns {boolean} - `true` if the name ends in `.sozi.json`.
 */
export function isPresentationFile(fileName) {
    return fileName.toLowerCase().endsWith(PRESENTATION_EXT);
}

/** Check the content of a presentation file.
 *
 * @param {string} text - The content of the file.
 * @returns {?string} - `null` if the content is presentation data: a JSON object
 *  with a `frames` array; else the reason why it is not.
 */
export function presentationDataError(text) {
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (err) {
        return err.message;
    }
    if (data === null || typeof data !== "object" || !Array.isArray(data.frames)) {
        return "no \"frames\" array";
    }
    return null;
}

/** Remove the presentation extension from a file name.
 *
 * The extension `.sozi.json` is matched in any letter case; another
 * extension, such as `.json`, is removed as well.
 *
 * @param {string} presentation - The path of a presentation file.
 * @returns {string} - The path without its extension.
 */
function presentationBase(presentation) {
    return isPresentationFile(presentation) ?
        presentation.slice(0, -PRESENTATION_EXT.length) :
        replaceFileExtWith(presentation, "");
}

/** The file set of a presentation.
 *
 * By default, the presentation file is the SVG file name with the extension
 * `.sozi.json`. The HTML and presenter HTML files are named after the
 * presentation file and written beside it, so that in the default case
 * every file is beside the SVG and named after it.
 * With an output directory, the HTML files are written there instead.
 *
 * The paths can be absolute or bare file names; the results keep the same form.
 *
 * @param {string} svg - The path of the SVG file.
 * @param {?string} [presentation] - The path of the presentation file, if not the default.
 * @param {object} [options] - Options.
 * @param {?string} [options.outputDir] - The directory of the HTML files: a path relative to
 *  the directory of the presentation file, or absolute. Empty or absent: beside the presentation file.
 * @returns {{svg: string, presentation: string, html: string, presenter: string, outputDir: string}} -
 *  The file paths, and the directory of the HTML files.
 */
export function presentationFiles(svg, presentation, {outputDir} = {}) {
    if (!presentation) {
        presentation = replaceFileExtWith(svg, PRESENTATION_EXT);
    }
    let base = presentationBase(presentation);
    if (outputDir) {
        const presentationDir = path.dirname(presentation);
        const dir = path.isAbsolute(outputDir) ? outputDir : path.join(presentationDir, outputDir);
        base = path.join(dir, path.basename(base));
    }
    return {
        svg,
        presentation,
        html:      base + ".sozi.html",
        presenter: base + "-presenter.sozi.html",
        outputDir: path.dirname(base)
    };
}

/** The SVG file of a presentation file.
 *
 * @param {string} presentation - The path of the presentation file.
 * @param {?string} [svgKey] - The `svg` key of the presentation file: a path relative to its directory.
 * @returns {string} - The path of the SVG file: the `svg` key resolved against the directory
 *  of the presentation, or `<base>.svg` beside the presentation when the key is empty or absent.
 */
export function svgOfPresentation(presentation, svgKey) {
    if (!svgKey) {
        return presentationBase(presentation) + ".svg";
    }
    return path.isAbsolute(svgKey) ? path.normalize(svgKey) : path.join(path.dirname(presentation), svgKey);
}

/** The `svg` key to store in a presentation file.
 *
 * @param {string} svg - The path of the SVG file.
 * @param {string} presentation - The path of the presentation file.
 * @returns {string} - An empty string if the SVG is `<base>.svg` beside the presentation,
 *  else the path of the SVG relative to the directory of the presentation, with forward slashes.
 */
export function svgKeyOf(svg, presentation) {
    if (path.normalize(svg) === path.normalize(svgOfPresentation(presentation))) {
        return "";
    }
    return path.relative(path.dirname(presentation), svg).split(path.sep).join("/");
}
