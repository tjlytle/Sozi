/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Work a session left in its outbox as patch files when it could not push: which files the
// next try of the stage is handed, and the prompt section that tells it what to do with them.
// The usage-limit carry (carry.patch, carry.bundle) is carry.js's, not this module's.

/** The most patches handed to the next try; a session can write anything to its outbox. */
const MAX_PATCHES = 10;

/**
 * The patch files of an outbox to hand to the next try: names ending in `.patch` other than
 * the usage-limit carry's `carry.patch`, sorted, the first ten.
 *
 * @param {string[]} names - The file names in the outbox.
 * @returns {string[]} - The names kept.
 */
export function leftoverPatches(names) {
    return names
        .filter(name => name.endsWith(".patch") && name !== "carry.patch")
        .sort()
        .slice(0, MAX_PATCHES);
}

/**
 * The prompt section that hands the last try's patches to the next one.
 *
 * @param {string[]} paths - The patch paths as the session sees them.
 * @returns {string} - The Markdown section.
 */
export function leftoverNote(paths) {
    const list = paths.map(file => `- \`${file}\``).join("\n");
    return [
        "## Work left by the last try",
        "",
        "The last try of this stage could not push its work and saved it as patches:",
        "",
        list,
        "",
        "Before you start, apply them on the issue's branch with `git apply --3way <file>`, " +
            "check the result, and carry on from there. If a patch does not apply, or the " +
            "branch already holds that work, say so in your log and start as usual.",
        ""
    ].join("\n");
}

/**
 * What a start of a stage takes over from the patches the last try left: the files to copy
 * under the new outbox's carried/, and the note on their paths that ends the prompt. Nothing
 * when the last try was of another stage, or no try left patches.
 *
 * @param {import("./state.js").Leftover | null | undefined} leftover - The issue's record.
 * @param {string} stage - The stage starting.
 * @returns {{patches: {from: string, names: string[]}, note: string} | null} - The handover.
 */
export function handover(leftover, stage) {
    if (leftover?.stage !== stage) {
        return null;
    }
    const paths = leftover.patches.map(name => `/outbox/carried/${name}`);
    return {patches: {from: leftover.outbox, names: leftover.patches}, note: leftoverNote(paths)};
}
