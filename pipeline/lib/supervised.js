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

/** A line that may name a path git applies to. Lines inside hunks can look like one too; they
 * are read the same way, which can refuse a good patch but never passes a bad one.
 */
const HEADER = /^(?:diff |--- |\+\+\+ |rename |copy )/;

/** The paths one header line names: both sides of `diff --git`, one side of `---` or `+++`
 * (none for /dev/null), the path of a rename or copy line.
 *
 * @param {string} line - A line HEADER matches.
 * @returns {string[]} - The paths as written.
 * @throws {Error} - When the line does not have that plain form: a Git-quoted path, a space
 *     in a path, a side without its a/ or b/ prefix, a combined diff.
 */
function headerPaths(line) {
    const header = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
    if (header) {
        return header.slice(1);
    }
    const side = /^(?:---|\+\+\+) (?:\/dev\/null|[ab]\/(\S+))$/.exec(line);
    if (side) {
        return side[1] ? [side[1]] : [];
    }
    const moved = /^(?:rename|copy) (?:from|to) (\S+)$/.exec(line);
    if (moved) {
        return [moved[1]];
    }
    throw new Error(`the patch has a header it cannot read: ${JSON.stringify(line)}`);
}

/** The paths a git diff names. Every line that may name a path must have the plain form, so
 * the paths found cover every file git would apply the patch to.
 *
 * @param {string} patchText - The diff.
 * @returns {string[]} - The paths as written, in order, each once.
 * @throws {Error} - When a header line has a form not read here.
 */
function diffPaths(patchText) {
    const found = new Set();
    for (const line of patchText.split("\n")) {
        if (HEADER.test(line)) {
            headerPaths(line).forEach(p => found.add(p));
        }
    }
    return [...found];
}

/** The paths a protected patch changes, all of which must lie under `.claude/`.
 *
 * @param {string} patchText - The patch, a git diff.
 * @returns {string[]} - The paths, each once.
 * @throws {Error} - When the patch names no path, one outside `.claude/`, or has a header
 *     line it cannot read; the message names the path or the line.
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
