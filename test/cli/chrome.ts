/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Headless Chrome for the CLI tests: the DOM, the document title or a screenshot of an
// HTML file after its scripts ran. Chrome missing or impossible to spawn skips the test;
// a run that hangs or fails fails it, with Chrome's output.

import assert from "node:assert/strict";
import type {SpawnSyncReturns} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {TestContext} from "node:test";

import {decodePng} from "./decode.ts";
import type {DecodedPng} from "./decode.ts";
import {limit} from "./helpers.js";
import {spawnKeepingOutput} from "./spawn.ts";

/** The path of the Chrome binary the tests run. */
export const CHROME = "/usr/bin/google-chrome";

/** The arguments every headless Chrome run starts with. */
const HEADLESS = ["--headless=new", "--disable-gpu", "--no-sandbox"];

/** Check the result of a headless Chrome run.
 *
 * Only a failure to spawn Chrome (ENOENT, EACCES) skips the test; any other spawn error
 * or a non-zero exit status fails it. A timeout never reaches here: `spawnKeepingOutput`
 * throws it with Chrome's output.
 *
 * @returns `true` if Chrome ran, `false` if the test was skipped.
 */
export function chromeRan(t: TestContext, result: SpawnSyncReturns<string>): boolean {
    const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "EACCES") {
        t.skip(`headless Chrome could not be run: ${result.error}`);
        return false;
    }
    assert.ifError(result.error);
    assert.equal(result.status, 0, `headless Chrome failed: ${result.stderr}`);
    return true;
}

/** Run `fn` with a fresh Chrome profile directory, removed afterwards.
 *
 * Skips the test and returns null when Chrome is missing.
 */
function withProfile<T>(t: TestContext, fn: (profile: string) => T): T | null {
    if (!fs.existsSync(CHROME)) {
        t.skip(`${CHROME} not found`);
        return null;
    }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-chrome-"));
    try {
        return fn(profile);
    } finally {
        fs.rmSync(profile, {recursive: true, force: true});
    }
}

/** The DOM of an HTML file after its scripts ran in headless Chrome.
 *
 * @returns The serialized DOM, or null when the test was skipped.
 */
export function browserDom(t: TestContext, file: string): string | null {
    return withProfile(t, profile => {
        const result = spawnKeepingOutput(
            CHROME,
            [...HEADLESS, `--user-data-dir=${profile}`, "--dump-dom", "file://" + file],
            {
                encoding: "utf8",
                timeout: limit(60000),
                killSignal: "SIGKILL",
                maxBuffer: 64 * 1024 * 1024
            }
        );
        return chromeRan(t, result) ? result.stdout : null;
    });
}

/** A PNG screenshot of an HTML file in headless Chrome, after its scripts ran.
 *
 * The window is 800 by 450 pixels unless `size` says otherwise.
 *
 * @returns The decoded screenshot, or null when the test was skipped.
 */
export function browserScreenshot(
    t: TestContext,
    file: string,
    {width = 800, height = 450}: {width?: number; height?: number} = {}
): DecodedPng | null {
    return withProfile(t, profile => {
        const png = path.join(profile, "shot.png");
        const result = spawnKeepingOutput(
            CHROME,
            [
                ...HEADLESS,
                "--hide-scrollbars",
                `--user-data-dir=${profile}`,
                // Let the player run its initial transition before the screenshot.
                "--virtual-time-budget=5000",
                `--window-size=${width},${height}`,
                `--screenshot=${png}`,
                "file://" + file
            ],
            {encoding: "utf8", timeout: limit(60000), killSignal: "SIGKILL"}
        );
        return chromeRan(t, result) ? decodePng(fs.readFileSync(png)) : null;
    });
}

/** Decode the character references that the HTML serializer emits in text. */
function decodeHtml(text: string): string {
    const chars: Record<string, string> = {
        lt: "<",
        gt: ">",
        quot: '"',
        "#39": "'",
        nbsp: " ",
        amp: "&"
    };
    return text.replace(/&(lt|gt|quot|#39|nbsp|amp);/g, (m, name: string) => chars[name]);
}

/** The decoded text of the `<title>` element in a serialized DOM; throws when it has none. */
export function documentTitle(dom: string): string {
    const match = /<title>([^<]*)<\/title>/.exec(dom);
    assert.ok(match, "no <title> in the dumped DOM");
    return decodeHtml(match[1]);
}

/** The document title of an HTML file after its scripts ran in headless Chrome.
 *
 * @returns The decoded document title, or null when the test was skipped.
 */
export function browserTitle(t: TestContext, file: string): string | null {
    const dom = browserDom(t, file);
    return dom === null ? null : documentTitle(dom);
}
