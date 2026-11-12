/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Writing a fresh outbox for a session: the prompt, the allow list, the commit identities,
// and what a resumed or retried session carries over. Reading what a session left is
// outbox.js's job.

import fs from "node:fs";
import path from "node:path";
import {copyCarry, copyPatches} from "./outbox.js";
import {PERSONAS} from "./profile.js";

/**
 * @typedef {object} OutboxOptions
 * @property {number} issue - The issue number.
 * @property {string} stage - The stage name.
 * @property {string} prompt - The prompt, written as prompt.md.
 * @property {string} allow - The allow list, written as allow.txt.
 * @property {string} [carryFrom] - A stopped session's outbox whose carry files are copied.
 * @property {string} [resume] - The message written as resume.md.
 * @property {{from: string, names: string[]}} [patches] - The last try's patch files, copied into carried/.
 * @property {Date} [now] - The time the directory name carries; the current time when absent.
 */

/**
 * Two digits.
 *
 * @param {number} n - A number below 100.
 * @returns {string} The number, zero padded.
 */
function pad(n) {
    return String(n).padStart(2, "0");
}

/**
 * Copy each persona's commit identity (the BOT_GIT_NAME and BOT_GIT_EMAIL lines of the
 * host's gh-bot bot-env, nothing else) into a session's outbox, so gh-as commits from a
 * container carry the App identity (#80). A persona without a host file is skipped.
 *
 * @param {string} from - The host gh-bot directory.
 * @param {string} to - The outbox's gh-bot directory.
 * @returns {void}
 */
export function copyIdentities(from, to) {
    for (const persona of PERSONAS) {
        let text;
        try {
            text = fs.readFileSync(path.join(from, persona, "bot-env"), "utf8");
        } catch {
            continue;
        }
        const lines = text
            .split("\n")
            .map(line => line.trim())
            .filter(line => /^BOT_GIT_(NAME|EMAIL)=/.test(line));
        if (lines.length > 0) {
            fs.mkdirSync(path.join(to, persona), {recursive: true});
            fs.writeFileSync(path.join(to, persona, "bot-env"), `${lines.join("\n")}\n`);
        }
    }
}

/**
 * Make a new directory out-<issue>-<stage>-<time> under varDir; a name already taken gets
 * a -2, -3 and so on suffix.
 *
 * @param {string} varDir - The directory the outboxes live in.
 * @param {string} base - The name without a suffix.
 * @returns {string} The path of the new directory.
 */
function freshDir(varDir, base) {
    fs.mkdirSync(varDir, {recursive: true});
    const first = path.join(varDir, base);
    let dir = first;
    for (let n = 2; ; n++) {
        try {
            fs.mkdirSync(dir);
            return dir;
        } catch (error) {
            if (/** @type {{code?: string}} */ (error).code !== "EEXIST") {
                throw error;
            }
            dir = `${first}-${n}`;
        }
    }
}

/**
 * Write a fresh outbox. With carryFrom, the carry files of that stopped session's outbox
 * are copied; with resume, the message is written as resume.md; with patches, the last
 * try's patch files are copied into carried/.
 *
 * @param {string} varDir - The directory the outboxes live in.
 * @param {string} botConfigDir - The host gh-bot directory the commit identities come from.
 * @param {OutboxOptions} opts - What the outbox holds.
 * @returns {string} The outbox's path.
 */
export function prepareOutbox(
    varDir,
    botConfigDir,
    {issue, stage, prompt, allow, carryFrom, resume, patches, now}
) {
    const at = now ?? new Date();
    const time = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;
    const dir = freshDir(varDir, `out-${issue}-${stage}-${time}`);
    fs.writeFileSync(path.join(dir, "prompt.md"), prompt);
    fs.writeFileSync(path.join(dir, "allow.txt"), allow);
    copyIdentities(botConfigDir, path.join(dir, "gh-bot"));
    if (carryFrom) {
        copyCarry(carryFrom, dir);
    }
    if (patches) {
        copyPatches(patches.from, patches.names, dir);
    }
    if (resume !== undefined) {
        fs.writeFileSync(path.join(dir, "resume.md"), resume);
    }
    return dir;
}
