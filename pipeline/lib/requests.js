/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Outbox requests: the files a session writes for the loop to act on when it
// ends. Request files are untrusted input from a model, so every field is checked;
// result.json and the log are read in outbox.js.

import fs from "node:fs";
import path from "node:path";
import {readBounded} from "./outbox.js";

export {readResult} from "./outbox.js";

const PERSONAS = ["advocate", "architect", "builder", "qa", "reviewer", "ops"];
const HARNESSES = ["claude", "codex", "opencode"];

const DONE_TARGETS = [
    "stage:tests",
    "stage:in-progress",
    "stage:review",
    "stage:qa",
    "stage:done",
    "stage:blocked",
    "stage:parked",
    "triage"
];

const LABELS = [
    "stage:todo",
    "stage:blocked",
    "stage:tests",
    "stage:in-progress",
    "stage:review",
    "stage:qa",
    "stage:done",
    "stage:parked",
    "triage",
    "idea",
    "working"
];

const MAX_REQUEST_BYTES = 16 * 1024;

const NEVER_ADDED = ["stage:done", "working"];
const NEVER_REMOVED = ["working"];

/**
 * @typedef {object} DoneRequest
 * @property {"done"} kind - Request kind.
 * @property {number} issue - The issue to move.
 * @property {string} to - The stage or label to move it to.
 */

/**
 * @typedef {object} LabelRequest
 * @property {"label"} kind - Request kind.
 * @property {number} issue - The issue to relabel.
 * @property {string[]} add - Labels to add.
 * @property {string[]} remove - Labels to remove.
 */

/**
 * @typedef {object} SpawnRequest
 * @property {"spawn"} kind - Request kind.
 * @property {string} persona - The persona to run.
 * @property {string} prompt - What to ask it.
 * @property {number} [issue] - The issue it works on.
 * @property {string} [harness] - The harness to run it in.
 */

/**
 * @typedef {object} NoteRequest
 * @property {"note"} kind - Request kind.
 * @property {string} text - The note.
 */

/**
 * @typedef {object} WaitRequest
 * @property {"wait"} kind - Request kind.
 * @property {string} reason - What a person is to do; the issue waits until its stage changes.
 */

/**
 * @typedef {DoneRequest | LabelRequest | SpawnRequest | NoteRequest | WaitRequest} Request
 */

/**
 * @typedef {object} Refusal
 * @property {string} file - The request file name.
 * @property {string} reason - Why it was refused.
 */

/**
 * @typedef {import("./outbox.js").Usage} Usage
 * @typedef {import("./outbox.js").Result} Result
 */

/**
 * @param {unknown} value - A value from a request file.
 * @returns {value is Record<string, unknown>} Whether it is a plain object.
 */
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value - A value from a request file.
 * @returns {value is number} Whether it is a positive safe integer.
 */
function isIssue(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * @param {unknown} value - A value from a request file.
 * @param {string} what - What the value is, for the error message.
 * @returns {string[]} The value as a list of labels, or an empty list when absent.
 */
function labelList(value, what) {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.some(v => typeof v !== "string")) {
        throw new Error(`${what} must be a list of labels`);
    }
    return value;
}

/**
 * Check a label request on an issue other than the session's own: no stage label either
 * way, and no lifting it out of triage. Only the loop and a person move other issues.
 *
 * @param {number} target - The issue the request names.
 * @param {string[]} add - Labels to add.
 * @param {string[]} remove - Labels to remove.
 * @returns {void}
 * @throws {Error} When the request would move the other issue.
 */
function otherIssueLabels(target, add, remove) {
    for (const label of [...add, ...remove]) {
        if (label.startsWith("stage:")) {
            throw new Error(`label may not change ${label} on issue ${target}, not this session's`);
        }
    }
    if (remove.includes("triage")) {
        throw new Error(`label may not lift issue ${target} out of triage`);
    }
}

/**
 * Check one parsed request object and return its normalised form.
 *
 * @param {unknown} obj - The parsed request file.
 * @param {{issue: number}} session - The session the request came from.
 * @returns {Request} The normalised request.
 * @throws {Error} When the request is not allowed; the message says why.
 */
export function validateRequest(obj, {issue}) {
    if (!isObject(obj)) {
        throw new Error("request must be an object");
    }
    const keys = Object.keys(obj);
    if (keys.length !== 1) {
        throw new Error("one request per file");
    }
    const kind = keys[0];
    const body = obj[kind];

    if (kind === "note") {
        if (typeof body !== "string" || body.trim() === "") {
            throw new Error("note must be a non-empty string");
        }
        return {kind: "note", text: body};
    }
    if (kind === "wait") {
        if (issue === 0) {
            throw new Error("wait needs a session that works on an issue");
        }
        if (typeof body !== "string" || body.trim() === "") {
            throw new Error("wait must be a non-empty string: what a person is to do");
        }
        return {kind: "wait", reason: body};
    }
    if (!["done", "label", "spawn"].includes(kind)) {
        throw new Error(`unknown request kind ${kind}`);
    }
    if (!isObject(body)) {
        throw new Error(`${kind} must be an object`);
    }

    if (kind === "done") {
        if (body.issue !== issue) {
            throw new Error(
                `done may only move this session's issue ${issue}, not issue ${body.issue}`
            );
        }
        if (typeof body.to !== "string" || !DONE_TARGETS.includes(body.to)) {
            throw new Error(`done target ${body.to} is not one of ${DONE_TARGETS.join(", ")}`);
        }
        return {kind: "done", issue, to: body.to};
    }

    if (kind === "label") {
        if (!isIssue(body.issue)) {
            throw new Error("label needs an issue number");
        }
        const add = labelList(body.add, "add");
        const remove = labelList(body.remove, "remove");
        for (const label of [...add, ...remove]) {
            if (!LABELS.includes(label)) {
                throw new Error(`label ${label} is not one the loop allows`);
            }
        }
        for (const label of add) {
            if (NEVER_ADDED.includes(label)) {
                throw new Error(`label may not add ${label}`);
            }
        }
        for (const label of remove) {
            if (NEVER_REMOVED.includes(label)) {
                throw new Error(`label may not remove ${label}`);
            }
        }
        if (body.issue !== issue) {
            otherIssueLabels(body.issue, add, remove);
        }
        return {kind: "label", issue: body.issue, add, remove};
    }

    if (typeof body.persona !== "string" || !PERSONAS.includes(body.persona)) {
        throw new Error(`spawn needs a persona, one of ${PERSONAS.join(", ")}`);
    }
    if (typeof body.prompt !== "string" || body.prompt.trim() === "") {
        throw new Error("spawn needs a non-empty prompt");
    }
    /** @type {SpawnRequest} */
    const spawn = {kind: "spawn", persona: body.persona, prompt: body.prompt};
    if (body.issue !== undefined) {
        if (!isIssue(body.issue)) {
            throw new Error("spawn issue must be an issue number");
        }
        spawn.issue = body.issue;
    }
    if (body.harness !== undefined) {
        if (typeof body.harness !== "string" || !HARNESSES.includes(body.harness)) {
            throw new Error(`spawn harness ${body.harness} is not one of ${HARNESSES.join(", ")}`);
        }
        spawn.harness = body.harness;
    }
    return spawn;
}

/**
 * Order request file names by their number when both carry one, else by name.
 *
 * @param {string} a - A file name.
 * @param {string} b - Another file name.
 * @returns {number} Sort order.
 */
function compareNames(a, b) {
    const na = /^req-(\d+)/.exec(a);
    const nb = /^req-(\d+)/.exec(b);
    if (na && nb && Number(na[1]) !== Number(nb[1])) {
        return Number(na[1]) - Number(nb[1]);
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Read every req-*.json file in an outbox, in name order. Never throws.
 *
 * @param {string} dir - The outbox directory.
 * @param {{issue: number}} session - The session the requests came from.
 * @returns {{accepted: Request[], refused: Refusal[]}} The requests, sorted by outcome.
 */
export function readRequests(dir, {issue}) {
    /** @type {Request[]} */
    const accepted = [];
    /** @type {Refusal[]} */
    const refused = [];
    let names;
    try {
        names = fs
            .readdirSync(dir)
            .filter(n => /^req-.*\.json$/.test(n))
            .sort(compareNames);
    } catch {
        return {accepted, refused};
    }
    for (const file of names) {
        const read = readBounded(path.join(dir, file), MAX_REQUEST_BYTES);
        if ("refused" in read) {
            refused.push({file, reason: read.refused});
            continue;
        }
        let parsed;
        try {
            parsed = JSON.parse(read.text);
        } catch {
            refused.push({file, reason: "not JSON"});
            continue;
        }
        try {
            accepted.push(validateRequest(parsed, {issue}));
        } catch (err) {
            refused.push({file, reason: err instanceof Error ? err.message : String(err)});
        }
    }
    return {accepted, refused};
}
