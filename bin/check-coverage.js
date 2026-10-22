#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Test coverage by annotation, standard 6.2. For each changed source file:
//
//   - a unit test covers it when a test file under test/ (outside test/features) has
//     the same base name: test/cli/naming.test.js covers src/js/naming.js;
//   - a feature file covers it when its "# covers:" header lists the file or a
//     directory above it: "# covers: src/js/presenter/" covers every file there;
//   - a PR body may waive one file with a line "No test: <path> - <reason>", which
//     the reviewer then sees.
//
// It also lists tests that changed together with the code they cover, which is the
// case to look at twice: was the behaviour meant to change (then the feature file
// changed first), and what other test still covers the related behaviour unchanged?
//
//   node bin/check-coverage.js [--base REF] [--files PATH...] [--body-file FILE] [--json]
//
// With --base (default origin/master) the changed files come from the diff; with
// --files they are given, and the working tree's modified files count as "changed
// together". Exit status is non-zero when a changed source file is uncovered and not
// waived.

import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const SOURCE = /^src\/(js\/.*\.(?:js|ts|tsx)|templates\/.*\.html)$/;
const NOT_SOURCE = /\.d\.ts$|^src\/js\/types\//;
const UNIT_TEST = /^test\/(?!features\/|fixtures\/).*\.test\.(?:js|ts)$/;
const FEATURE = /^test\/features\/.*\.feature$/;
const WAIVER = /^\s*No test:\s*(\S+)\s*[-:–]\s*(.+)$/gim;

/** The repository root.
 *
 * @returns {string} - The absolute path.
 */
function root() {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
}

/** Every file under a directory, as repository-relative paths.
 *
 * @param {string} base - The repository root.
 * @param {string} dir - The directory, relative to the root.
 * @returns {string[]} - The paths.
 */
function filesUnder(base, dir) {
    const out = [];
    const walk = d => {
        for (const entry of fs.readdirSync(d, {withFileTypes: true})) {
            const p = path.join(d, entry.name);
            if (entry.isDirectory()) {
                walk(p);
            } else {
                out.push(path.relative(base, p).split(path.sep).join("/"));
            }
        }
    };
    if (fs.existsSync(path.join(base, dir))) {
        walk(path.join(base, dir));
    }
    return out;
}

/** Whether a path is a source file the standard expects a test for.
 *
 * @param {string} p - A repository-relative path.
 * @returns {boolean} - True for src/js code and src/templates pages.
 */
export function isSource(p) {
    return SOURCE.test(p) && !NOT_SOURCE.test(p);
}

/** The paths a feature file declares it covers.
 *
 * @param {string} text - The feature file.
 * @returns {string[]} - Files and directories (directories end in "/").
 */
export function coversOf(text) {
    const m = /^\s*#\s*covers:\s*(.+)$/im.exec(text);
    return m
        ? m[1]
              .split(",")
              .map(s => s.trim())
              .filter(Boolean)
        : [];
}

/** Whether a covers entry applies to a source path.
 *
 * @param {string} entry - A file path or a directory path ending in "/".
 * @param {string} source - The source path.
 * @returns {boolean} - True when it covers.
 */
export function entryCovers(entry, source) {
    return entry.endsWith("/") ? source.startsWith(entry) : entry === source;
}

/** The base name a unit test and a source file share.
 *
 * @param {string} p - A path.
 * @returns {string} - The name without directories, ".test" and the extension.
 */
export function stem(p) {
    return path
        .basename(p)
        .replace(/\.test(?=\.[^.]+$)/, "")
        .replace(/\.[^.]+$/, "");
}

/** The waivers a PR body grants.
 *
 * @param {string} body - The PR body.
 * @returns {Map<string, string>} - Path to reason.
 */
export function waivers(body) {
    const out = new Map();
    for (const m of body.matchAll(WAIVER)) {
        out.set(m[1], m[2].trim());
    }
    return out;
}

/** The coverage index of the repository: which tests cover which sources.
 *
 * @param {string} base - The repository root.
 * @returns {{unitTests: string[], features: {path: string, covers: string[]}[]}} - The index.
 */
export function index(base) {
    const tests = filesUnder(base, "test");
    return {
        unitTests: tests.filter(p => UNIT_TEST.test(p)),
        features: tests
            .filter(p => FEATURE.test(p))
            .map(p => ({path: p, covers: coversOf(fs.readFileSync(path.join(base, p), "utf8"))}))
    };
}

/** The tests covering one source file.
 *
 * @param {{unitTests: string[], features: {path: string, covers: string[]}[]}} idx - The index.
 * @param {string} source - The source path.
 * @returns {string[]} - Test paths.
 */
export function coveringTests(idx, source) {
    const s = stem(source);
    return [
        ...idx.unitTests.filter(t => stem(t) === s),
        ...idx.features.filter(f => f.covers.some(e => entryCovers(e, source))).map(f => f.path)
    ];
}

/** The sources a test file covers.
 *
 * @param {{unitTests: string[], features: {path: string, covers: string[]}[]}} idx - The index.
 * @param {string[]} sources - Every source path in the repository.
 * @param {string} test - The test path.
 * @returns {string[]} - Source paths.
 */
export function coveredSources(idx, sources, test) {
    const feature = idx.features.find(f => f.path === test);
    if (feature) {
        return sources.filter(s => feature.covers.some(e => entryCovers(e, s)));
    }
    const s = stem(test);
    return sources.filter(p => stem(p) === s);
}

/** Assess a set of changed files.
 *
 * @param {object} args - The inputs.
 * @param {{unitTests: string[], features: {path: string, covers: string[]}[]}} args.idx - The index.
 * @param {string[]} args.sources - Every source path in the repository.
 * @param {string[]} args.changed - The changed paths.
 * @param {Map<string, string>} args.waived - Waivers from the PR body.
 * @returns {{sources: {path: string, covered: string[], waived: ?string}[], together: {test: string, sources: string[]}[]}} - The report.
 */
export function assess({idx, sources, changed, waived}) {
    const changedSet = new Set(changed);
    const report = {
        sources: changed
            .filter(isSource)
            .map(p => ({path: p, covered: coveringTests(idx, p), waived: waived.get(p) || null})),
        together: changed
            .filter(p => UNIT_TEST.test(p) || FEATURE.test(p))
            .map(t => ({
                test: t,
                sources: coveredSources(idx, sources, t).filter(s => changedSet.has(s))
            }))
            .filter(x => x.sources.length > 0)
    };
    return report;
}

/** Run the check and print a report.
 *
 * @param {string[]} argv - The command-line arguments after the script name.
 * @returns {number} - The exit status.
 */
export function main(argv) {
    const base = root();
    const arg = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
    const json = argv.includes("--json");
    let changed;
    if (argv.includes("--files")) {
        const start = argv.indexOf("--files") + 1;
        const end = argv.findIndex((a, i) => i >= start && a.startsWith("--"));
        changed = argv
            .slice(start, end === -1 ? undefined : end)
            .map(p => path.relative(base, path.resolve(p)).split(path.sep).join("/"));
        const status = spawnSync("git", ["status", "--porcelain"], {cwd: base, encoding: "utf8"});
        for (const line of status.stdout.split("\n")) {
            if (line.length > 3) {
                changed.push(line.slice(3).trim());
            }
        }
        changed = [...new Set(changed)];
    } else {
        const ref = arg("--base", "origin/master");
        changed = execFileSync("git", ["diff", "--name-only", `${ref}...HEAD`], {
            cwd: base,
            encoding: "utf8"
        })
            .split("\n")
            .filter(Boolean);
    }
    const bodyFile = arg("--body-file", null);
    const body = bodyFile ? fs.readFileSync(bodyFile, "utf8") : process.env.PR_BODY || "";
    const idx = index(base);
    const sources = [...filesUnder(base, "src/js"), ...filesUnder(base, "src/templates")].filter(
        isSource
    );
    const report = assess({idx, sources, changed, waived: waivers(body)});
    const uncovered = report.sources.filter(s => s.covered.length === 0 && !s.waived);
    if (json) {
        console.log(JSON.stringify(report));
        return uncovered.length ? 1 : 0;
    }
    for (const s of report.sources) {
        const how = s.covered.length
            ? `covered by ${s.covered.join(", ")}`
            : s.waived
              ? `no test, waived: ${s.waived}`
              : "NOT COVERED";
        console.log(`${s.path}: ${how}`);
    }
    for (const t of report.together) {
        console.log(
            `changed together: ${t.test} and ${t.sources.join(", ")}. Was the behaviour meant to change? Which other test still covers the related behaviour unchanged?`
        );
    }
    console.log(
        uncovered.length
            ? `${uncovered.length} source file(s) without a test; add a scenario or a unit test, or a "No test: <path> - <reason>" line in the PR body`
            : "ok"
    );
    return uncovered.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main(process.argv.slice(2)));
}
