/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Export a presentation to a PPTX document, one slide image per frame (main process).
 *
 * @module
 */

import path from "path";
import * as tmp from "tmp";
import * as fs from "fs";
import officegen from "officegen";
import {requireFrames} from "./frames.js";
import {removeOnExit, removeTmpDir, writeOutput} from "./files.js";
import {withExportWindow} from "./capture-window.js";
import {progress} from "./options.js";

/** The available slide sizes for PPTX export.
 *
 * Slide sizes are represented by aspect ratios regardless of a physical size.
 * The export function will assume a screen height equal to 1080 pixels.
 * The keys represent all formats supported by the Officegen PPTX API.
 * All formats are in landscape mode by default.
 *
 * @readonly
 * @type {object}
 */
const pptxSlideGeometry = {
    "35mm": {width: 11.25, height: 7.5}, // in
    A3: {width: 420, height: 297}, // mm
    A4: {width: 297, height: 210}, // mm
    B4ISO: {width: 353, height: 250}, // mm
    B4JIS: {width: 364, height: 257}, // mm
    B5ISO: {width: 250, height: 176}, // mm
    B5JIS: {width: 257, height: 182}, // mm
    banner: {width: 8, height: 1}, // in
    hagakiCard: {width: 148, height: 100}, // mm
    ledger: {width: 17, height: 11}, // in
    letter: {width: 11, height: 8.5}, // in
    overhead: {width: 10, height: 7.5}, // in
    screen16x10: {width: 16, height: 10}, // no unit
    screen16x9: {width: 16, height: 9}, // no unit
    screen4x3: {width: 4, height: 3} // no unit
};

/** The default height of PPTX slides, in pixels.
 *
 * @readonly
 * @default
 * @type {number}
 */
const pptxSlideHeightPx = 1080;

/** Implementation of {@linkcode module:exporter.exportToPPTX|exportToPPTX} (main process).
 *
 * @param {object} presentation - The presentation settings.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The export options, with defaults.
 * @returns {Promise<object>} - The export result.
 */
export async function pptxExport(presentation, htmlPath, opts) {
    const outPath = opts.outPath || htmlPath.replace(/html$/, "pptx");
    const frames = requireFrames(
        presentation,
        presentation.exportToPPTXInclude,
        presentation.exportToPPTXExclude
    );

    // Get the PPTX slide size and convert it to pixels.
    const geometry = pptxSlideGeometry[presentation.exportToPPTXSlideSize];
    if (!geometry) {
        throw new Error(`unknown PPTX slide size: ${presentation.exportToPPTXSlideSize}`);
    }
    const g = {
        width: Math.round((geometry.width * pptxSlideHeightPx) / geometry.height),
        height: pptxSlideHeightPx
    };

    // A temporary directory for the slide images, deleted even if not empty.
    const destDir = tmp.dirSync({unsafeCleanup: true});
    const cancelRemoval = removeOnExit(destDir.name);
    try {
        const pptxDoc = officegen("pptx");
        pptxDoc.setSlideSize(g.width, g.height, presentation.exportToPPTXSlideSize);
        const windowOpts = Object.assign({}, opts, g, {transparent: false});
        const {warnings, capture} = await withExportWindow(htmlPath, windowOpts, ew =>
            captureSlides(ew, frames, destDir.name, pptxDoc, opts)
        );
        await writeOutput(outPath, partial => writePptx(pptxDoc, partial));
        return {out: outPath, frames: frames.length, warnings, capture};
    } finally {
        cancelRemoval();
        removeTmpDir(destDir);
    }
}

/** Capture each frame of a PPTX export and add its image as a slide.
 *
 * @param {import("./ExportWindow.js").ExportWindow} ew - The capture window.
 * @param {number[]} frames - The 0-based indices of the frames to capture.
 * @param {string} dir - The directory where the slide images are written.
 * @param {object} pptxDoc - The Officegen PPTX document.
 * @param {object} opts - The export options.
 * @returns {Promise<void>} - Resolved once every slide is added.
 */
async function captureSlides(ew, frames, dir, pptxDoc, opts) {
    for (let i = 0; i < frames.length; i++) {
        await ew.jumpToFrame(frames[i]);
        const fileName = path.join(dir, `img${String(i).padStart(6, "0")}.png`);
        fs.writeFileSync(fileName, await ew.capture());
        pptxDoc.makeNewSlide().addImage(fileName, {x: 0, y: 0, cx: "100%", cy: "100%"});
        progress(opts, i + 1, frames.length);
    }
}

/** Write a PPTX document to a file.
 *
 * @param {object} pptxDoc - The Officegen PPTX document.
 * @param {string} fileName - The file to write.
 * @returns {Promise<void>} - Resolved once the file is closed.
 */
function writePptx(pptxDoc, fileName) {
    return new Promise((resolve, reject) => {
        const pptxFile = fs.createWriteStream(fileName);
        // eslint-disable-next-line no-restricted-syntax -- node's stream event, not ours (standard 2.4)
        pptxFile.on("close", resolve);
        // eslint-disable-next-line no-restricted-syntax -- node's stream event, not ours (standard 2.4)
        pptxFile.on("error", reject);
        // eslint-disable-next-line no-restricted-syntax -- Officegen's event, not ours (standard 2.4)
        pptxDoc.on("error", reject);
        pptxDoc.generate(pptxFile, {
            error: err =>
                reject(err instanceof Error ? err : new Error(`PPTX generation failed: ${err}`))
        });
    });
}
