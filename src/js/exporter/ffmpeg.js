/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Find and run the ffmpeg executable that encodes a video export.
 *
 * @module
 */

import path from "path";
import process from "process";
import * as fs from "fs";
import {spawn} from "child_process";

/** Check whether a file is an executable regular file.
 *
 * @param {string} fileName - A file name.
 * @returns {boolean} - `true` if the file can be executed.
 */
function isExecutable(fileName) {
    try {
        fs.accessSync(fileName, fs.constants.X_OK);
        return fs.statSync(fileName).isFile();
    } catch {
        return false;
    }
}

/** Find an ffmpeg executable.
 *
 * Lookup order: an explicit path if given (it must exist), then `ffmpeg`
 * on the `PATH`, then the executable bundled in `process.resourcesPath`.
 *
 * @param {?string} explicitPath - A path given by the user, or `null`.
 * @returns {?string} - The path of an ffmpeg executable, or `null` if none was found.
 */
export function findFfmpeg(explicitPath = null) {
    if (explicitPath) {
        return isExecutable(explicitPath) ? path.resolve(explicitPath) : null;
    }
    const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
        if (dir && isExecutable(path.join(dir, exe))) {
            return path.join(dir, exe);
        }
    }
    if (process.resourcesPath && isExecutable(path.join(process.resourcesPath, exe))) {
        return path.join(process.resourcesPath, exe);
    }
    return null;
}

/** The default time limit of an ffmpeg run, in milliseconds.
 *
 * Ten minutes, plus 100 ms per image to encode, so that long videos are not
 * stopped (ffmpeg encodes from about 10 to 100 images per second).
 *
 * @param {number} imageCount - The number of images to encode.
 * @returns {number} - The time limit, in milliseconds.
 */
export function defaultFfmpegTimeoutMs(imageCount) {
    return 10 * 60 * 1000 + 100 * imageCount;
}

/** The error of an ffmpeg run that did not succeed.
 *
 * @param {boolean} timedOut - Was ffmpeg stopped at the time limit?
 * @param {number} timeoutMs - The time limit, in milliseconds.
 * @param {?number} code - The exit status of ffmpeg.
 * @param {?string} signal - The signal that terminated ffmpeg.
 * @param {string} stderr - The end of the standard error of ffmpeg.
 * @returns {Error} - The error to report, with the end of the standard error.
 */
function ffmpegError(timedOut, timeoutMs, code, signal, stderr) {
    const tail = stderr.trim();
    if (timedOut) {
        return new Error(
            `ffmpeg did not finish within ${timeoutMs / 1000} s and was stopped` +
                (tail ? `: ${tail}` : "")
        );
    }
    return new Error(
        `ffmpeg failed (${signal ? "signal " + signal : "exit status " + code}): ${tail}`
    );
}

/** Run ffmpeg and wait for it to terminate.
 *
 * ffmpeg is killed if it runs longer than `timeoutMs`, and when this process
 * exits (e.g. when the command line times out), so that it never outlives the export.
 *
 * @param {string} ffmpegPath - The ffmpeg executable.
 * @param {string[]} args - The command-line arguments.
 * @param {number} timeoutMs - The time limit, in milliseconds.
 * @returns {Promise<void>} - Resolved when ffmpeg succeeds; rejected with its status and the end of its standard error otherwise.
 */
export function runFfmpeg(ffmpegPath, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        let stderr = "";
        let timedOut = false;
        const child = spawn(ffmpegPath, args, {stdio: ["ignore", "ignore", "pipe"]});
        const kill = () => {
            try {
                child.kill("SIGKILL");
            } catch {
                // The process is already gone.
            }
        };
        const timer = setTimeout(
            () => {
                timedOut = true;
                kill();
            },
            Math.min(timeoutMs, 2 ** 31 - 1)
        );
        // Before the other exit handlers, which remove the files that ffmpeg writes.
        // eslint-disable-next-line no-restricted-syntax -- node's process event, not ours (standard 2.4)
        process.prependListener("exit", kill);
        const done = () => {
            clearTimeout(timer);
            // eslint-disable-next-line no-restricted-syntax -- node's process event, not ours (standard 2.4)
            process.removeListener("exit", kill);
        };
        // eslint-disable-next-line no-restricted-syntax -- node's stream event, not ours (standard 2.4)
        child.stderr.on("data", chunk => {
            // Keep the end of the output, where ffmpeg explains failures.
            stderr = (stderr + chunk).slice(-4000);
        });
        // eslint-disable-next-line no-restricted-syntax -- node's child process event, not ours (standard 2.4)
        child.on("error", err => {
            done();
            reject(new Error(`could not run ${ffmpegPath}: ${err.message}`));
        });
        // eslint-disable-next-line no-restricted-syntax -- node's child process event, not ours (standard 2.4)
        child.on("close", (code, signal) => {
            done();
            if (code === 0 && !timedOut) {
                resolve();
            } else {
                reject(ffmpegError(timedOut, timeoutMs, code, signal, stderr));
            }
        });
    });
}
