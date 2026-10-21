#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pull request shape, code-standard.md section 5:
//
//   - the branch is named for its issue: <number>-<slug>,
//   - the body closes that issue ("Closes #<number>"),
//   - the diff against the base does not include build noise
//     (locales/messages.pot, yarn.lock).
//
//   node bin/check-pr.js [--base REF] [--branch NAME] [--body-file FILE]
//
// REF defaults to origin/master, NAME to the current branch, and the body comes from
// --body-file or the PR_BODY environment variable. Exit status is non-zero if any
// check failed.

import {execFileSync} from "node:child_process";
import fs from "node:fs";
import {pathToFileURL} from "node:url";

export const BRANCH = /^(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BUILD_NOISE = ["locales/messages.pot", "yarn.lock"];

/** The issue number a branch name carries, or null.
 *
 * @param {string} branch - The branch name.
 * @returns {?number} - The issue number.
 */
export function issueOfBranch(branch) {
    const m = BRANCH.exec(branch);
    return m ? Number(m[1]) : null;
}

/** The issue numbers a PR body closes.
 *
 * @param {string} body - The PR body.
 * @returns {number[]} - The numbers after "Closes #", "Fixes #" or "Resolves #".
 */
export function closedIssues(body) {
    return [
        ...body.matchAll(
            /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[\w-]+\/[\w.-]+)?#(\d+)/gi
        )
    ].map(m => Number(m[1]));
}

/** The build-noise files among a list of changed paths.
 *
 * @param {string[]} paths - The changed paths.
 * @returns {string[]} - Those that are build noise.
 */
export function noiseIn(paths) {
    return paths.filter(p => BUILD_NOISE.includes(p));
}

/** Check one PR and return the problems found.
 *
 * @param {{branch: string, body: ?string, changed: string[]}} pr - The branch name, the body (null when unknown) and the changed paths.
 * @returns {string[]} - The problems, empty when the shape is right.
 */
export function problems({branch, body, changed}) {
    const out = [];
    const issue = issueOfBranch(branch);
    if (issue === null) {
        out.push(`branch "${branch}" is not <issue number>-<slug> (code-standard.md 5)`);
    }
    if (body !== null) {
        const closes = closedIssues(body);
        if (closes.length === 0) {
            out.push("the PR body does not close an issue; add a line like Closes #12");
        } else if (issue !== null && !closes.includes(issue)) {
            out.push(`the branch is for #${issue} but the body closes #${closes.join(", #")}`);
        }
    }
    for (const p of noiseIn(changed)) {
        out.push(`${p} is build noise; revert it before committing (CLAUDE.md)`);
    }
    return out;
}

/** Run the check on the current repository and print a report.
 *
 * @param {string[]} argv - The command-line arguments after the script name.
 * @returns {number} - The exit status.
 */
export function main(argv) {
    const arg = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
    const base = arg("--base", "origin/master");
    const branch = arg(
        "--branch",
        execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {encoding: "utf8"}).trim()
    );
    const bodyFile = arg("--body-file", null);
    const body = bodyFile ? fs.readFileSync(bodyFile, "utf8") : (process.env.PR_BODY ?? null);
    const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
        encoding: "utf8"
    })
        .split("\n")
        .filter(Boolean);
    const found = problems({branch, body, changed});
    for (const p of found) {
        console.log(`FAIL ${p}`);
    }
    console.log(found.length ? `${found.length} problem(s)` : "ok");
    return found.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main(process.argv.slice(2)));
}
