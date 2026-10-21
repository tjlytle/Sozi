#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Dependency check, code-standard.md section 4. For every package added to or changed
// in package.json since the base branch:
//
//   - the version is pinned exactly (no ^, ~ or range),
//   - the lockfile carries that exact version,
//   - the licence is in the allowed set,
//   - a runtime package had a release within the last year (dev tools: not checked),
//   - the pull request body names the package (when a body is given),
//   - its minified size is printed, so the PR can state it.
//
// And, always: nothing in src/ loads a script or stylesheet from a URL at run time.
//
//   node bin/check-deps.js [--base REF] [--body-file FILE]
//
// REF defaults to origin/master. The body comes from --body-file or the PR_BODY
// environment variable; with neither, the mention check is skipped. Exit status is
// non-zero if any check failed. The "named in the plan" rule is the reviewer's.

import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

export const ALLOWED_LICENCES = new Set([
    "MIT",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "0BSD",
    "ISC",
    "Apache-2.0",
    "MPL-2.0",
    "OFL-1.1",
    "CC0-1.0",
    "Unlicense"
]);
export const MAX_AGE_DAYS = 365;
const RUNTIME_URL = /(?:src|href)\s*=\s*["']https?:\/\/|import\(\s*["']https?:\/\//;
const COMMENTS = /<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g;

/** A source text with its HTML, block and line comments removed.
 *
 * @param {string} text - The source.
 * @returns {string} - The source without comments.
 */
export function withoutComments(text) {
    return text.replace(COMMENTS, "$1");
}

/** The packages added to or changed in `dependencies`/`devDependencies` between two manifests.
 *
 * @param {object} base - The base package.json.
 * @param {object} head - The head package.json.
 * @returns {{name: string, version: string, runtime: boolean}[]} - The changes.
 */
export function changedPackages(base, head) {
    const out = [];
    for (const [field, runtime] of [
        ["dependencies", true],
        ["devDependencies", false]
    ]) {
        const before = base[field] || {};
        for (const [name, version] of Object.entries(head[field] || {})) {
            if (before[name] !== version) {
                out.push({name, version, runtime});
            }
        }
    }
    return out;
}

/** Whether a version string is an exact pin.
 *
 * @param {string} version - The value in package.json.
 * @returns {boolean} - True for `1.2.3` or `1.2.3-beta.1`, false for ranges and URLs.
 */
export function isExactPin(version) {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

/** The version the lockfile holds for a package, or null.
 *
 * @param {object} lock - The parsed package-lock.json.
 * @param {string} name - The package name.
 * @returns {?string} - The locked version.
 */
export function lockedVersion(lock, name) {
    const entry = (lock.packages || {})[`node_modules/${name}`];
    return entry ? entry.version : null;
}

/** The files under a directory whose text loads a script or stylesheet from a URL.
 *
 * @param {string} dir - The directory to scan.
 * @returns {string[]} - The offending files.
 */
export function runtimeUrlLoads(dir) {
    const out = [];
    const walk = d => {
        for (const entry of fs.readdirSync(d, {withFileTypes: true})) {
            const p = path.join(d, entry.name);
            if (entry.isDirectory()) {
                walk(p);
            } else if (
                /\.(js|ts|tsx|html|css)$/.test(entry.name) &&
                RUNTIME_URL.test(withoutComments(fs.readFileSync(p, "utf8")))
            ) {
                out.push(p);
            }
        }
    };
    if (fs.existsSync(dir)) {
        walk(dir);
    }
    return out;
}

/** Whether a text names a package.
 *
 * @param {string} body - The PR body.
 * @param {string} name - The package name.
 * @returns {boolean} - True when the name appears as a whole word.
 */
export function mentions(body, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    return new RegExp(`(^|[^\\w@/-])${escaped}([^\\w/-]|$)`, "m").test(body);
}

/** What npm knows about a package: licence and the date of its latest release.
 *
 * @param {string} name - The package name.
 * @returns {{licence: string, modified: Date}} - The registry facts.
 */
function registryFacts(name) {
    const out = execFileSync("npm", ["view", name, "license", "time.modified", "--json"], {
        encoding: "utf8"
    });
    const data = JSON.parse(out);
    return {licence: String(data.license || ""), modified: new Date(data["time.modified"])};
}

/** The minified size of a package when bundled, in bytes.
 *
 * @param {string} root - The repository root.
 * @param {string} name - The package name.
 * @returns {?number} - The size, or null when the package cannot be bundled (a native or node-only package).
 */
function minifiedSize(root, name) {
    const r = spawnSync(
        path.join(root, "node_modules", ".bin", "esbuild"),
        ["--bundle", "--minify", "--format=esm", "--log-level=silent"],
        {
            cwd: root,
            input: `import * as m from ${JSON.stringify(name)}; console.log(m);`,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024
        }
    );
    return r.status === 0 ? Buffer.byteLength(r.stdout) : null;
}

/** Run every check and print a report.
 *
 * @param {string[]} argv - The command-line arguments after the script name.
 * @returns {number} - The exit status.
 */
export function main(argv) {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
    const baseRef = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : "origin/master";
    const bodyFile = argv.includes("--body-file") ? argv[argv.indexOf("--body-file") + 1] : null;
    const body = bodyFile ? fs.readFileSync(bodyFile, "utf8") : process.env.PR_BODY || null;

    const head = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    const baseText = spawnSync("git", ["show", `${baseRef}:package.json`], {
        cwd: root,
        encoding: "utf8"
    });
    const base = baseText.status === 0 ? JSON.parse(baseText.stdout) : {};
    let failed = 0;
    const fail = message => {
        failed++;
        console.log(`FAIL ${message}`);
    };

    const changes = changedPackages(base, head);
    console.log(`${changes.length} added or changed package(s) since ${baseRef}`);
    for (const {name, version, runtime} of changes) {
        console.log(`\n${name}@${version}${runtime ? "" : " (dev)"}`);
        if (!isExactPin(version)) {
            fail(`${name}: "${version}" is not an exact version (code-standard.md 4)`);
        }
        const locked = lockedVersion(lock, name);
        if (!locked) {
            fail(`${name}: not in package-lock.json; run npm install and commit the lockfile`);
        } else if (isExactPin(version) && locked !== version) {
            fail(`${name}: lockfile has ${locked}, package.json says ${version}`);
        }
        let facts;
        try {
            facts = registryFacts(name);
        } catch (e) {
            fail(`${name}: npm view failed (${e.message.split("\n")[0]})`);
        }
        if (facts) {
            if (!ALLOWED_LICENCES.has(facts.licence)) {
                fail(
                    `${name}: licence "${facts.licence}" is not in the allowed set (${[...ALLOWED_LICENCES].join(", ")})`
                );
            } else {
                console.log(`  licence ${facts.licence}`);
            }
            const ageDays = (Date.now() - facts.modified.getTime()) / 86400000;
            const released = facts.modified.toISOString().slice(0, 10);
            if (runtime && !(ageDays <= MAX_AGE_DAYS)) {
                fail(`${name}: last release ${released}, more than ${MAX_AGE_DAYS} days ago`);
            } else {
                console.log(
                    `  last release ${released}${runtime ? "" : " (dev: age not checked)"}`
                );
            }
        }
        if (runtime) {
            const size = minifiedSize(root, name);
            console.log(
                size === null
                    ? "  minified size: not bundleable (node-only or native)"
                    : `  minified size ${(size / 1024).toFixed(1)} KB`
            );
        }
        if (body !== null && !mentions(body, name)) {
            fail(
                `${name}: the PR body does not name it; state the package, why, its licence and size`
            );
        }
    }

    const urls = runtimeUrlLoads(path.join(root, "src"));
    for (const file of urls) {
        fail(
            `${path.relative(root, file)} loads a script or stylesheet from a URL at run time (code-standard.md 4)`
        );
    }
    console.log(failed ? `\n${failed} problem(s)` : "\nok");
    return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main(process.argv.slice(2)));
}
