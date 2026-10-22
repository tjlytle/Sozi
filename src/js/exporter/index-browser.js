/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

/** Export a presentation to a PDF document.
 *
 * @param {module:model/Presentation.Presentation} _presentation - The presentation to export.
 * @param {string} _htmlFileName - The name of the presentation HTML file.
 * @returns {Promise} - A promise that resolves when the operation completes.
 */
export function exportToPDF(_presentation, _htmlFileName) {
    console.log("Export to PDF not supported on this platform.");
    return Promise.resolve();
}

/** Export a presentation to a PPTX document.
 *
 * @param {module:model/Presentation.Presentation} _presentation - The presentation to export.
 * @param {string} _htmlFileName - The name of the presentation HTML file.
 * @returns {Promise} - A promise that resolves when the operation completes.
 */
export function exportToPPTX(_presentation, _htmlFileName) {
    console.log("Export to PPTX not supported on this platform.");
    return Promise.resolve();
}

/** Export a presentation to a video document.
 *
 * @param {module:model/Presentation.Presentation} _presentation - The presentation to export.
 * @param {string} _htmlFileName - The name of the presentation HTML file.
 * @returns {Promise} - A promise that resolves when the operation completes.
 */
export function exportToVideo(_presentation, _htmlFileName) {
    console.log("Export to video not supported on this platform.");
    return Promise.resolve();
}

/** Render frames of a presentation to PNG images.
 *
 * @param {module:model/Presentation.Presentation} _presentation - The presentation to render.
 * @param {string} _htmlFileName - The name of the presentation HTML file.
 * @returns {Promise} - A promise that resolves when the operation completes.
 */
export function renderFrames(_presentation, _htmlFileName) {
    console.log("Rendering frames is not supported on this platform.");
    return Promise.resolve();
}

/** Copy the export settings of a presentation (not supported on this platform).
 *
 * @param {module:model/Presentation.Presentation} _presentation - The presentation.
 * @returns {object} - An empty object.
 */
export function exportSettings(_presentation) {
    return {};
}

/** Find an ffmpeg executable (not supported on this platform).
 *
 * @param {?string} _explicitPath - A path given by the user, or `null`.
 * @returns {null} - Always `null`.
 */
export function findFfmpeg(_explicitPath) {
    return null;
}
