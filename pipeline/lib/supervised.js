/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The supervision rules (#516): which issues the supervisor runs instead of the loop, which
// plans put an issue there, and which patches the supervisor may apply for a stage.

import path from "node:path";

/** The label of an issue the supervisor runs and the loop skips. */
export const SUPERVISED = "supervised";

/** A path a plan may name that puts its issue under the supervisor. */
const SUPERVISED_PATHS = [/^\.claude\//, /^pipeline\//, /^bin\/pipeline\.js$/];

/** Tells whether the supervisor runs an issue, not the loop.
 *
 * @param {{labels: string[]}} record - The issue.
 * @returns {boolean} - True when it is labelled supervised.
 */
export function isSupervised(record) {
    return record.labels.includes(SUPERVISED);
}

/** The body of a plan's Shape section: from its heading to the next heading of that level.
 *
 * @param {string} planText - The plan comment.
 * @returns {string} - The section's body; empty when the plan has none.
 */
function shapeSection(planText) {
    const start = /^(#+) Shape\s*$/m.exec(planText);
    if (!start) {
        return "";
    }
    const rest = planText.slice(start.index + start[0].length);
    const end = new RegExp(`^#{1,${start[1].length}} `, "m").exec(rest);
    return end ? rest.slice(0, end.index) : rest;
}

/** Tells whether a plan changes the pipeline or .claude/: a path in code quotes in its Shape
 * section under `.claude/` or `pipeline/`, or `bin/pipeline.js`. A path cited elsewhere in
 * the plan does not count.
 *
 * @param {string} planText - The plan comment.
 * @returns {boolean} - True when its issue belongs to the supervisor.
 */
export function planNeedsSupervision(planText) {
    const quoted = [...shapeSection(planText).matchAll(/`([^`\s]+)`/g)].map(m => m[1]);
    return quoted.some(p => SUPERVISED_PATHS.some(rule => rule.test(p.replace(/^\.\//, ""))));
}

/** The paths a git diff names: both sides of each file header, renames and copies, but not
 * /dev/null.
 *
 * @param {string} patchText - The diff.
 * @returns {string[]} - The paths as written, in order, each once.
 */
function diffPaths(patchText) {
    const found = new Set();
    for (const line of patchText.split("\n")) {
        const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
        const side = /^(?:---|\+\+\+) [ab]\/(\S+)/.exec(line);
        const moved = /^(?:rename|copy) (?:from|to) (\S+)$/.exec(line);
        for (const p of header ? header.slice(1) : [side?.[1], moved?.[1]]) {
            if (p) {
                found.add(p);
            }
        }
    }
    return [...found];
}

/** The paths a protected patch changes, all of which must lie under `.claude/`.
 *
 * @param {string} patchText - The patch, a git diff.
 * @returns {string[]} - The paths, each once.
 * @throws {Error} - When the patch names no path, or one outside `.claude/`; the message
 *     names the path.
 */
export function protectedPatchPaths(patchText) {
    const paths = diffPaths(patchText);
    if (paths.length === 0) {
        throw new Error("the patch names no path");
    }
    for (const p of paths) {
        if (!path.posix.normalize(p).startsWith(".claude/")) {
            throw new Error(`the patch changes ${p}, outside .claude/`);
        }
    }
    return paths;
}
