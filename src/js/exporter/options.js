/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The options of an export: their defaults and the progress callback.
 *
 * @module
 */

import process from "process";
import {DEFAULT_TIMEOUT_MS} from "./ExportWindow.js";

/** Fill the default options of an export.
 *
 * @param {object} opts - The options given by the caller.
 * @returns {object} - The options with defaults.
 */
export function withDefaults(opts) {
    return Object.assign(
        {
            outPath: null,
            ffmpegPath: null,
            hidden: !process.env.SOZI_EXPORT_SHOW,
            transparent: false,
            frameNumber: false,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            ffmpegTimeoutMs: null,
            onProgress: null
        },
        opts || {}
    );
}

/** Report progress to the caller, ignoring errors in the callback.
 *
 * @param {object} opts - The export options.
 * @param {number} done - The number of steps done.
 * @param {number} total - The total number of steps.
 */
export function progress(opts, done, total) {
    if (typeof opts.onProgress === "function") {
        try {
            opts.onProgress({done, total});
        } catch {
            // A failing progress callback must not break the export.
        }
    }
}
