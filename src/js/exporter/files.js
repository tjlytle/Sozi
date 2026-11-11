/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Write, move and clean up the files of an export.
 *
 * An export never leaves a partial output or its temporary images behind, even
 * when it fails or this process exits first.
 *
 * @module
 */

import path from "path";
import process from "process";
import * as fs from "fs";

/** Run a clean-up function when this process exits before the export ends.
 *
 * A command line that times out exits at once: this keeps the captured
 * images and partial output files from staying behind.
 *
 * @param {Function} fn - The clean-up function; its errors are ignored.
 * @returns {Function} - Call it to cancel the clean-up.
 */
function cleanUpOnExit(fn) {
    const cleanUp = () => {
        try {
            fn();
        } catch {
            // Nothing more can be done while exiting.
        }
    };
    // eslint-disable-next-line no-restricted-syntax -- node's process event, not ours (standard 2.4)
    process.on("exit", cleanUp);
    // eslint-disable-next-line no-restricted-syntax -- node's process event, not ours (standard 2.4)
    return () => process.removeListener("exit", cleanUp);
}

/** Remove a directory when this process exits before the export ends.
 *
 * @param {string} dir - The directory to remove.
 * @returns {Function} - Call it to cancel the removal.
 */
export function removeOnExit(dir) {
    return cleanUpOnExit(() => fs.rmSync(dir, {recursive: true, force: true}));
}

/** Remove the directories created by `fs.mkdirSync(dir, {recursive: true})` if they are empty.
 *
 * @param {string} dir - The directory given to `mkdirSync`.
 * @param {string|undefined} created - The first directory created, as returned by `mkdirSync`, or `undefined`.
 */
function removeCreatedDirs(dir, created) {
    if (!created) {
        return;
    }
    for (let d = path.resolve(dir); ; d = path.dirname(d)) {
        try {
            fs.rmdirSync(d);
        } catch {
            // Not empty, or already gone: keep it and its parents.
            return;
        }
        if (d === path.resolve(created) || d === path.dirname(d)) {
            return;
        }
    }
}

/** The name of the partial file written before an output file is complete.
 *
 * @param {string} outPath - The output file, e.g. `dir/talk.webm`.
 * @returns {string} - The partial file in the same directory, e.g. `dir/.talk.partial.webm`.
 */
export function partialPath(outPath) {
    const ext = path.extname(outPath);
    return path.join(path.dirname(outPath), `.${path.basename(outPath, ext)}.partial${ext}`);
}

/** Write an output file without replacing the previous one before success.
 *
 * The missing directories of the file are created, then `write` writes a
 * partial file in the same directory, which is renamed to `outPath` once it
 * is complete. On failure, or if this process exits first, the partial file
 * and the directories created here are removed: the previous output stays as it was.
 *
 * @param {string} outPath - The output file.
 * @param {function(string):(Promise<void>|void)} write - Writes the file at the path it is given.
 * @returns {Promise} - Resolved once `outPath` is complete.
 */
export async function writeOutput(outPath, write) {
    const dir = path.dirname(outPath);
    const created = fs.mkdirSync(dir, {recursive: true});
    const partial = partialPath(outPath);
    const cleanUp = () => {
        fs.rmSync(partial, {force: true});
        removeCreatedDirs(dir, created);
    };
    const cancelCleanUp = cleanUpOnExit(cleanUp);
    try {
        await write(partial);
        fs.renameSync(partial, outPath);
    } catch (err) {
        try {
            cleanUp();
        } catch {
            // Report the error of the export, not of the clean-up.
        }
        throw err;
    } finally {
        cancelCleanUp();
    }
}

/** Move a file, also across file systems.
 *
 * @param {string} from - The source file.
 * @param {string} to - The target file, replaced if it exists.
 */
export function moveFile(from, to) {
    try {
        fs.renameSync(from, to);
    } catch (err) {
        // Cast: renameSync throws system errors, which have a code.
        if (/** @type {{code?: string}} */ (err).code !== "EXDEV") {
            throw err;
        }
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
    }
}

/** Make a file a hard link of another one, or a copy if the link fails.
 *
 * A copy is always a correct result: links fail across file systems (EXDEV),
 * on file systems without hard links (ENOTSUP, EOPNOTSUPP, EPERM: FAT, exFAT,
 * some network and FUSE mounts) and beyond the link count limit (EMLINK).
 *
 * @param {string} from - The existing file.
 * @param {string} to - The new file.
 */
export function linkOrCopy(from, to) {
    try {
        fs.linkSync(from, to);
    } catch {
        fs.copyFileSync(from, to);
    }
}

/** Remove a temporary directory, ignoring failures.
 *
 * @param {?object} dir - A directory created by `tmp.dirSync`, or `null`.
 */
export function removeTmpDir(dir) {
    if (dir) {
        try {
            dir.removeCallback();
        } catch {
            // Ignore failures to remove the temporary directory.
        }
    }
}

/** Move the images of a PNG sequence into the output directory, then remove the earlier images.
 *
 * The directory is created if needed. Images that were hard links of one file
 * stay hard links of one file when the move copies them to another file system.
 * The earlier `img000000.png`... images that were not replaced are removed last;
 * other files are kept.
 *
 * @param {string[]} files - The images, in a temporary directory.
 * @param {string} dir - The output directory.
 * @returns {string[]} - The images in the output directory.
 */
export function moveSequence(files, dir) {
    fs.mkdirSync(dir, {recursive: true});
    const moved = new Map(); // inode -> the image already moved to the output directory
    const result = files.map(file => {
        const target = path.join(dir, path.basename(file));
        const {ino} = fs.statSync(file);
        if (moved.has(ino)) {
            // Replace an earlier image first: a link cannot overwrite a file.
            fs.rmSync(target, {force: true});
            linkOrCopy(moved.get(ino), target);
            fs.unlinkSync(file);
        } else {
            moveFile(file, target);
            moved.set(ino, target);
        }
        return target;
    });
    const names = new Set(result.map(file => path.basename(file)));
    for (const name of fs.readdirSync(dir)) {
        if (/^img\d{6}\.png$/.test(name) && !names.has(name)) {
            fs.unlinkSync(path.join(dir, name));
        }
    }
    return result;
}
