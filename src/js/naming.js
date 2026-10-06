/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The names of the files of a presentation.
 *
 * This module has no dependencies so that it can be used by the editor,
 * the command-line mode and unit tests alike.
 *
 * @module
 */

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

/** The file set of a presentation.
 *
 * By default, the presentation file is the SVG file name with the extension
 * `.sozi.json`. The HTML and presenter HTML files are named after the
 * presentation file and written beside it, so that in the default case
 * every file is beside the SVG and named after it.
 *
 * The paths can be absolute or bare file names; the results keep the same form.
 *
 * @param {string} svg - The path of the SVG file.
 * @param {?string} [presentation] - The path of the presentation file, if not the default.
 * @returns {{svg: string, presentation: string, html: string, presenter: string}} - The file paths.
 */
export function presentationFiles(svg, presentation) {
    if (!presentation) {
        presentation = replaceFileExtWith(svg, PRESENTATION_EXT);
    }
    const base = presentation.endsWith(PRESENTATION_EXT) ?
        presentation.slice(0, -PRESENTATION_EXT.length) :
        replaceFileExtWith(presentation, "");
    return {
        svg,
        presentation,
        html:      base + ".sozi.html",
        presenter: base + "-presenter.sozi.html"
    };
}
