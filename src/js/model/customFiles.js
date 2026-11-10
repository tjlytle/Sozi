/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** A deck's custom stylesheets and scripts, and the pages each one is for.
 *
 * In a presentation file an entry is a plain string for a file of the presentation page, as
 * it always was, or `{path, target}` for any other. Decks without targets stay byte for byte
 * the same.
 *
 * @module
 */

/** The pages a custom file can be for.
 *
 * @readonly
 */
export const CustomFileTargets = Object.freeze({
    display: "display",
    presenter: "presenter",
    both: "both"
});

/**
 * A custom file.
 *
 * @typedef {object} CustomFile
 * @property {string} path - Its path, relative to the SVG file.
 * @property {string} target - One of `CustomFileTargets`.
 */

/**
 * Read an entry of the `customFiles` of a presentation file.
 *
 * @param {any} entry - The entry: a path, or an object with a path and maybe a target.
 * @returns {CustomFile} The file.
 * @throws {TypeError} If the path or the target is not valid.
 */
export function readCustomFile(entry) {
    const {path, target = CustomFileTargets.display} =
        typeof entry === "string" ? {path: entry} : entry || {};
    if (typeof path !== "string" || !path) {
        throw new TypeError(`A custom file needs a path: ${JSON.stringify(entry)}`);
    }
    if (!Object.hasOwn(CustomFileTargets, target)) {
        throw new TypeError(`Custom file ${path} has an unknown target: ${target}`);
    }
    return {path, target};
}

/**
 * The entry that stores a custom file in a presentation file.
 *
 * @param {CustomFile} file - The file.
 * @returns {string | CustomFile} A plain string for a display file, else the path and target.
 */
export function storableCustomFile({path, target}) {
    return target === CustomFileTargets.display ? path : {path, target};
}

/**
 * The paths of the custom files for a page.
 *
 * @param {CustomFile[]} files - The custom files.
 * @param {"display" | "presenter"} page - The page.
 * @param {string} ext - The extension of the files to pick.
 * @returns {string[]} The paths, in the order of the files.
 */
export function customFilesFor(files, page, ext) {
    return files
        .filter(({path, target}) => {
            return path.endsWith(ext) && (target === page || target === CustomFileTargets.both);
        })
        .map(({path}) => path);
}
