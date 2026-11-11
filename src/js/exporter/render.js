/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Render frames of a presentation to PNG images, one image per frame (main process).
 *
 * @module
 */

import path from "path";
import * as fs from "fs";
import {removeOnExit} from "./files.js";
import {withExportWindow} from "./capture-window.js";
import {progress} from "./options.js";

/** Implementation of {@linkcode module:exporter.renderFrames|renderFrames} (main process).
 *
 * @param {object} presentation - The presentation settings.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The render options, with defaults.
 * @returns {Promise<object>} - The render result.
 */
export async function frameRender(presentation, htmlPath, opts) {
    const width = Number(opts.width);
    const height = Number(opts.height);
    if (!(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
        throw new Error(`invalid image size: ${opts.width}x${opts.height}`);
    }
    const images = opts.frames || [];
    if (!images.length) {
        throw new Error("no frames selected for export");
    }
    for (const {index} of images) {
        if (!(Number.isInteger(index) && index >= 0 && index < presentation.frames.length)) {
            throw new Error(`frame index out of range: ${index}`);
        }
    }

    const files = [];
    const windowOpts = Object.assign({}, opts, {width, height, transparent: false});
    const cancelRemoval = opts.tempDir ? removeOnExit(opts.tempDir) : () => {};
    try {
        const {warnings, capture} = await withExportWindow(htmlPath, windowOpts, async ew => {
            for (const {index, file} of images) {
                await ew.jumpToFrame(index);
                const png = await ew.capture();
                fs.mkdirSync(path.dirname(file), {recursive: true});
                fs.writeFileSync(file, png);
                files.push(file);
                progress(opts, files.length, images.length);
            }
        });
        return {files, size: {width, height}, warnings, capture};
    } finally {
        cancelRemoval();
    }
}
