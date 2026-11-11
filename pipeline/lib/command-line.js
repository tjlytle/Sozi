#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// The command line of bin/pipeline.js, read without side effects: the usage text, the
// --until value, and the options and target, checked.

import {parseArgs} from "node:util";
import {PERSONAS} from "./profile.js";
import {HARNESSES} from "./routing.js";

/** The usage lines, printed with an argument error. */
export const USAGE = [
    "usage: node bin/pipeline.js [watch | --once | <#> | --status | --digest | --build-image]",
    "                            [--until <6h|90m|07:00>] [--epic <#>] [--harness <name>]",
    "                            [--on-limit wait|fallback]",
    "       node bin/pipeline.js --login <persona> [--harness claude|codex|agy|opencode]   log a persona in inside a container",
    "       node bin/pipeline.js --copy-profile <from> <to>   copy one persona's profile, without its login, to another"
];

/** Read an --until value: a duration from now (6h, 90m) or the next time of day (07:00).
 *
 * @param {string} text - The value.
 * @param {Date} now - The current time.
 * @returns {Date} - When no new session may start.
 * @throws {Error} - When the value is neither form.
 */
export function parseUntil(text, now) {
    const duration = /^(\d+)([hm])$/.exec(text);
    if (duration) {
        const unit = duration[2] === "h" ? 3600 * 1000 : 60 * 1000;
        return new Date(now.getTime() + Number(duration[1]) * unit);
    }
    const time = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (time && Number(time[1]) < 24 && Number(time[2]) < 60) {
        const at = new Date(now);
        at.setHours(Number(time[1]), Number(time[2]), 0, 0);
        if (at <= now) {
            at.setDate(at.getDate() + 1);
        }
        return at;
    }
    throw new Error(`--until takes 6h, 90m or HH:MM, not ${JSON.stringify(text)}`);
}

/** Check a persona name.
 *
 * @param {string} persona - The name.
 * @throws {Error} - When it is not a persona.
 */
function checkPersona(persona) {
    if (!PERSONAS.includes(persona)) {
        throw new Error(`persona must be one of ${PERSONAS.join("|")}`);
    }
}

/** Read the command line.
 *
 * @param {string[]} argv - The arguments after the script name.
 * @returns {{opt: Record<string, any>, target: string}} - The options, and "watch" or an issue number.
 * @throws {Error} - When the arguments do not parse.
 */
export function parseCommand(argv) {
    const {values, positionals} = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            once: {type: "boolean"},
            status: {type: "boolean"},
            digest: {type: "boolean"},
            "build-image": {type: "boolean"},
            login: {type: "string"},
            "copy-profile": {type: "boolean"},
            until: {type: "string"},
            epic: {type: "string"},
            harness: {type: "string"},
            "on-limit": {type: "string"}
        }
    });
    if (values["copy-profile"]) {
        if (positionals.length !== 2) {
            throw new Error("--copy-profile takes <from> <to>");
        }
        positionals.forEach(checkPersona);
        return {opt: {...values, copy: positionals}, target: "watch"};
    }
    if (values.login !== undefined) {
        checkPersona(values.login);
        if (!HARNESSES.includes(values.harness ?? "claude")) {
            throw new Error(`harness must be one of ${HARNESSES.join("|")}`);
        }
    }
    const target = positionals[0] ?? "watch";
    if (positionals.length > 1 || !/^(watch|\d+)$/.test(target)) {
        throw new Error(`unexpected ${positionals.join(" ")}`);
    }
    if (values.epic !== undefined && !/^\d+$/.test(values.epic)) {
        throw new Error(`--epic takes an issue number, not ${JSON.stringify(values.epic)}`);
    }
    return {opt: values, target};
}
