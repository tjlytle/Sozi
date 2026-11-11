/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Export a presentation to a PDF document, one page per frame (main process).
 *
 * @module
 */

import * as fs from "fs";
import {PDFDocument} from "pdf-lib";
import {requireFrames} from "./frames.js";
import {writeOutput} from "./files.js";
import {withExportWindow} from "./capture-window.js";
import {progress} from "./options.js";

/** The available page sizes for PDF export.
 *
 * Page sizes are in pixels, assuming a resolution of 96 dpi,
 * for each format supported by the `printToPDF` function of the Electron API.
 * All formats are in landscape mode by default.
 *
 * @readonly
 * @type {object}
 */
const pdfPageGeometry = {
    A3: {width: 1587, height: 1123},
    A4: {width: 1123, height: 794},
    A5: {width: 794, height: 559},
    Legal: {width: 1344, height: 816},
    Letter: {width: 1056, height: 816},
    Tabloid: {width: 1632, height: 1056}
};

/** Implementation of {@linkcode module:exporter.exportToPDF|exportToPDF} (main process).
 *
 * @param {object} presentation - The presentation settings.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The export options, with defaults.
 * @returns {Promise<object>} - The export result.
 */
export async function pdfExport(presentation, htmlPath, opts) {
    const outPath = opts.outPath || htmlPath.replace(/html$/, "pdf");
    const frames = requireFrames(
        presentation,
        presentation.exportToPDFInclude,
        presentation.exportToPDFExclude
    );

    // Get the PDF page size and swap width and height in portrait orientation.
    const geometry = pdfPageGeometry[presentation.exportToPDFPageSize];
    if (!geometry) {
        throw new Error(`unknown PDF page size: ${presentation.exportToPDFPageSize}`);
    }
    const landscape = presentation.exportToPDFPageOrientation !== "portrait";
    const g = landscape ? geometry : {width: geometry.height, height: geometry.width};

    const {value: pdfBytes, warnings} = await withExportWindow(
        htmlPath,
        Object.assign({}, opts, g, {transparent: false}),
        async ew => {
            const pdfDoc = await PDFDocument.create();
            for (let i = 0; i < frames.length; i++) {
                await ew.jumpToFrame(frames[i]);
                const pdfData = await ew.bounded(
                    ew.window.webContents.printToPDF({
                        pageSize: presentation.exportToPDFPageSize,
                        landscape,
                        printBackground: true,
                        margins: {top: 0, bottom: 0, left: 0, right: 0}
                    }),
                    "printToPDF"
                );
                const pdfDocForFrame = await PDFDocument.load(pdfData);
                const [pdfPage] = await pdfDoc.copyPages(pdfDocForFrame, [0]);
                pdfDoc.addPage(pdfPage);
                progress(opts, i + 1, frames.length);
            }
            return pdfDoc.save();
        }
    );
    await writeOutput(outPath, partial => fs.writeFileSync(partial, pdfBytes));
    return {out: outPath, frames: frames.length, warnings, capture: "printToPDF"};
}
