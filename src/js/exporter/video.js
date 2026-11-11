/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Export a presentation to a video or a PNG image sequence (main process).
 *
 * @module
 */

import path from "path";
import * as tmp from "tmp";
import * as fs from "fs";
import {videoTimeline, timelineImageCount} from "./frames.js";
import {linkOrCopy, moveSequence, removeOnExit, removeTmpDir, writeOutput} from "./files.js";
import {defaultFfmpegTimeoutMs, findFfmpeg, runFfmpeg} from "./ffmpeg.js";
import {withExportWindow} from "./capture-window.js";
import {progress} from "./options.js";

/** The video formats of the export: the extension of the video file, or `png` for an image sequence.
 *
 * @readonly
 * @type {string[]}
 */
export const VIDEO_FORMATS = ["mp4", "ogv", "webm", "wmv", "png"];

/** Check the settings of a video export and find its output path and ffmpeg.
 *
 * @param {object} presentation - The presentation settings.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The export options, with defaults.
 * @returns {{format: string, isPNG: boolean, outPath: string, width: number, height: number, frameRate: number, ffmpegPath: ?string}} - The video
 *  to write; `ffmpegPath` is `null` for a PNG sequence.
 */
function videoOutput(presentation, htmlPath, opts) {
    const format = presentation.exportToVideoFormat;
    if (!VIDEO_FORMATS.includes(format)) {
        throw new Error(`unknown video format: ${format}; expected ${VIDEO_FORMATS.join(", ")}`);
    }
    const isPNG = format === "png";
    const outPath =
        opts.outPath ||
        (isPNG
            ? htmlPath.replace(/\.sozi\.html$|\.html$/, "-sozi-export")
            : htmlPath.replace(/html$/, format));

    const width = Number(presentation.exportToVideoWidth);
    const height = Number(presentation.exportToVideoHeight);
    const frameRate = Number(presentation.exportToVideoFrameRate);
    if (!(width > 0 && height > 0 && frameRate > 0)) {
        throw new Error(`invalid video size or frame rate: ${width}x${height} at ${frameRate} fps`);
    }
    if (!presentation.frames.length) {
        throw new Error("no frames selected for export");
    }

    let ffmpegPath = null;
    if (!isPNG) {
        ffmpegPath = findFfmpeg(opts.ffmpegPath);
        if (!ffmpegPath) {
            throw new Error(
                opts.ffmpegPath ? `ffmpeg not found: ${opts.ffmpegPath}` : "ffmpeg not found"
            );
        }
    }
    return {format, isPNG, outPath, width, height, frameRate, ffmpegPath};
}

/** Capture the images of a video timeline into a directory.
 *
 * @param {import("./ExportWindow.js").ExportWindow} ew - The capture window.
 * @param {object[]} timeline - The result of {@linkcode module:exporter.videoTimeline|videoTimeline}.
 * @param {string} dir - The directory where the images are written.
 * @param {object} opts - The export options.
 * @returns {Promise<string[]>} - The image files, `img000000.png`... in order.
 */
async function captureTimeline(ew, timeline, dir, opts) {
    const total = timelineImageCount(timeline);
    const files = [];
    /** Write the next image of the sequence, or link it to an earlier image with the same content.
     *
     * @param {?Buffer} png - The PNG data, or `null` when `sameAs` is given.
     * @param {?string} [sameAs] - An earlier image file with the same content.
     * @returns {string} - The image file.
     */
    const write = (png, sameAs = null) => {
        const fileName = path.join(dir, `img${String(files.length).padStart(6, "0")}.png`);
        if (sameAs) {
            linkOrCopy(sameAs, fileName);
        } else {
            // Cast: without sameAs, png holds the data.
            fs.writeFileSync(fileName, /** @type {Buffer} */ (png));
        }
        files.push(fileName);
        progress(opts, files.length, total);
        return fileName;
    };

    for (const step of timeline) {
        if (step.type === "hold") {
            await ew.jumpToFrame(step.frame);
            const first = write(await ew.capture());
            for (let i = 1; i < step.count; i++) {
                write(null, first);
            }
        } else {
            await ew.run(`sozi.exportDriver.setup(${step.to})`);
            for (const p of step.progress) {
                await ew.run(`sozi.exportDriver.step(${p})`);
                await ew.settle();
                await ew.expectFrame(step.from);
                write(await ew.capture());
            }
            await ew.run("sozi.exportDriver.finish()");
        }
    }
    return files;
}

/** Move a PNG sequence to its output directory, or encode the images to a video file.
 *
 * @param {string[]} files - The captured images, in `dir`.
 * @param {string} dir - The directory of the captured images.
 * @param {object} video - The result of `videoOutput`.
 * @param {object} presentation - The presentation settings.
 * @param {object} opts - The export options, with defaults.
 * @returns {Promise<?string[]>} - The images in the output directory for a PNG sequence, `null` for a video.
 */
async function finishVideo(files, dir, video, presentation, opts) {
    if (video.isPNG) {
        return moveSequence(files, video.outPath);
    }
    const ffmpegTimeoutMs =
        opts.ffmpegTimeoutMs > 0 ? opts.ffmpegTimeoutMs : defaultFfmpegTimeoutMs(files.length);
    await writeOutput(video.outPath, partial =>
        runFfmpeg(
            // Cast: a video other than a PNG sequence found ffmpeg in videoOutput.
            /** @type {string} */ (video.ffmpegPath),
            [
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-framerate",
                String(video.frameRate),
                "-start_number",
                "0",
                "-f",
                "image2",
                "-i",
                path.join(dir, "img%06d.png"),
                // Most codecs require even dimensions with 4:2:0 chroma subsampling.
                "-vf",
                "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-pix_fmt",
                "yuv420p",
                "-b:v",
                String(presentation.exportToVideoBitRate),
                partial
            ],
            ffmpegTimeoutMs
        )
    );
    return null;
}

/** Implementation of {@linkcode module:exporter.exportToVideo|exportToVideo} (main process).
 *
 * @param {object} presentation - The presentation settings.
 * @param {string} htmlPath - The path of the presentation HTML file.
 * @param {object} opts - The export options, with defaults.
 * @returns {Promise<object>} - The export result.
 */
export async function videoExport(presentation, htmlPath, opts) {
    const video = videoOutput(presentation, htmlPath, opts);
    const timeline = videoTimeline(presentation.frames, video.frameRate);

    // The images are captured in a temporary directory, deleted even if not empty.
    const destDir = tmp.dirSync({unsafeCleanup: true});
    const cancelRemoval = removeOnExit(destDir.name);
    try {
        const windowOpts = Object.assign({}, opts, {
            width: video.width,
            height: video.height,
            transparent: video.isPNG && opts.transparent
        });
        const {value: files, ...report} = await withExportWindow(htmlPath, windowOpts, ew =>
            captureTimeline(ew, timeline, destDir.name, opts)
        );
        /** @type {{[field: string]: unknown}} */
        const result = {
            out: video.outPath,
            format: video.format,
            frames: presentation.frames.length,
            images: files.length,
            ffmpeg: video.ffmpegPath,
            warnings: report.warnings,
            capture: report.capture
        };
        const moved = await finishVideo(files, destDir.name, video, presentation, opts);
        if (moved) {
            result.files = moved;
        }
        return result;
    } finally {
        cancelRemoval();
        removeTmpDir(destDir);
    }
}
