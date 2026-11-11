/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Select the frames of an export and compute the timeline of a video export.
 *
 * Pure functions: no file system, no window.
 *
 * @module
 */

/** Update the status of a sequence of frame numbers to include or exclude in the export.
 *
 * @param {boolean[]} list - The status of each frame of the presentation.
 * @param {number} first - The index of the first element to update.
 * @param {number} last - The index of the last element to update.
 * @param {number} step - The step between elements to update.
 * @param {boolean} value - The value to assign at each index.
 */
function markInterval(list, first, last, step, value) {
    if (step > 0) {
        for (let i = first; i <= last; i += step) {
            if (i >= 0 && i < list.length) {
                list[i] = value;
            }
        }
    }
}

/** Parse a list of frames to include or exclude from the export.
 *
 * ```
 * expr ::= interval ("," interval)*
 *
 * interval ::=
 *      INT                     // frame number
 *    | INT? ":" INT?           // first:last
 *    | INT? ":" INT? ":" INT?  // first:second:last
 * ```
 *
 * In an interval:
 * - If `first` is omitted, it is set to 1.
 * - If `second` is omitted, it is set to `first + 1`.
 * - If `last` is omitted, it is set to `list.length`.
 *
 * @param {boolean[]} list - The status of each frame of the presentation.
 * @param {string} expr - An expression that represents a list of frames.
 * @param {boolean} value - The value to assign for each frame to mark.
 */
function markFrames(list, expr, value) {
    const trimmed = (expr || "").trim();
    const frameExpr = trimmed.length ? trimmed : value ? "all" : "none";
    switch (frameExpr) {
        case "all":
            markInterval(list, 0, list.length - 1, 1, value);
            break;
        case "none":
            break;
        default:
            for (const intervalDef of frameExpr.split(",")) {
                const interval = intervalDef.split(":").map(s => s.trim());
                if (interval.length > 0) {
                    const first = interval[0] !== "" ? parseInt(interval[0]) - 1 : 0;
                    const last =
                        interval[interval.length - 1] !== ""
                            ? parseInt(interval[interval.length - 1]) - 1
                            : list.length - 1;
                    const second =
                        interval.length > 2 && interval[1] !== ""
                            ? parseInt(interval[1]) - 1
                            : first + 1;
                    if (!isNaN(first) && !isNaN(second) && !isNaN(last)) {
                        markInterval(list, first, last, second - first, value);
                    }
                }
            }
    }
}

/** Get the indices of the frames to export.
 *
 * @param {number} frameCount - The number of frames in the presentation.
 * @param {string} include - An expression that represents a list of frames to include (frame-list grammar, 1-based).
 * @param {string} exclude - An expression that represents a list of frames to exclude.
 * @returns {number[]} - The 0-based indices of the selected frames, in increasing order.
 */
export function selectFrames(frameCount, include, exclude) {
    const list = new Array(frameCount).fill(false);
    markFrames(list, include, true);
    markFrames(list, exclude, false);
    const result = [];
    list.forEach((selected, index) => {
        if (selected) {
            result.push(index);
        }
    });
    return result;
}

/** Select the frames of an export, and reject an empty selection.
 *
 * @param {object} presentation - The presentation settings.
 * @param {string} include - The frames to include (frame-list grammar).
 * @param {string} exclude - The frames to exclude.
 * @returns {number[]} - The 0-based indices of the selected frames.
 */
export function requireFrames(presentation, include, exclude) {
    const frames = selectFrames(presentation.frames.length, include, exclude);
    if (!frames.length) {
        throw new Error("no frames selected for export");
    }
    return frames;
}

/** The names of the presentation properties that the exporter reads.
 *
 * @readonly
 * @type {string[]}
 */
const settingNames = [
    "exportToPDFPageSize",
    "exportToPDFPageOrientation",
    "exportToPDFInclude",
    "exportToPDFExclude",
    "exportToPPTXSlideSize",
    "exportToPPTXInclude",
    "exportToPPTXExclude",
    "exportToVideoFormat",
    "exportToVideoWidth",
    "exportToVideoHeight",
    "exportToVideoFrameRate",
    "exportToVideoBitRate"
];

/** Copy the export settings and frame timings of a presentation into a plain object.
 *
 * @param {object} presentation - A presentation, or a plain object with the same export fields.
 * @returns {object} - The `exportTo*` fields and `frames[{timeoutMs, timeoutEnable, transitionDurationMs}]`.
 */
export function exportSettings(presentation) {
    const result = {};
    for (const name of settingNames) {
        result[name] = presentation[name];
    }
    result.frames = presentation.frames.map(f => ({
        timeoutMs: f.timeoutMs,
        timeoutEnable: f.timeoutEnable,
        transitionDurationMs: f.transitionDurationMs
    }));
    return result;
}

/** Compute the sequence of captures of a video export.
 *
 * The video starts at the first frame and holds each frame for its timeout
 * (at least one image, even when the timeout is 0), then plays the transition
 * to the next frame, one image per time step. After the last frame, it plays
 * the transition back to the first frame only if the last frame has its
 * timeout enabled; the video ends when it reaches the first frame again.
 *
 * @param {object[]} frames - The frames, with `timeoutMs`, `timeoutEnable` and `transitionDurationMs`.
 * @param {number} frameRate - The number of images per second.
 * @returns {object[]} - A list of `{type: "hold", frame, count}` and `{type: "transition", from, to, progress: number[]}`.
 */
export function videoTimeline(frames, frameRate) {
    const timeStepMs = 1000 / frameRate;
    const steps = [];
    let index = 0;
    for (;;) {
        // Ensure at least one image of each frame.
        const holdMs = frames[index].timeoutMs;
        let count = 0;
        while (count * timeStepMs < holdMs) {
            count++;
        }
        steps.push({type: "hold", frame: index, count: Math.max(count, 1)});

        const next = (index + 1) % frames.length;
        if (next === 0 && !frames[index].timeoutEnable) {
            break;
        }

        const durationMs = frames[next].transitionDurationMs;
        const progress = [];
        for (let k = 0; k * timeStepMs < durationMs; k++) {
            progress.push((k * timeStepMs) / durationMs);
        }
        steps.push({type: "transition", from: index, to: next, progress});

        if (next === 0) {
            break;
        }
        index = next;
    }
    return steps;
}

/** Count the images of a video timeline.
 *
 * @param {object[]} timeline - The result of {@linkcode module:exporter.videoTimeline|videoTimeline}.
 * @returns {number} - The number of images.
 */
export function timelineImageCount(timeline) {
    return timeline.reduce((n, s) => n + (s.type === "hold" ? s.count : s.progress.length), 0);
}
