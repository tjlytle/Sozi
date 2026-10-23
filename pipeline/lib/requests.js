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
 * Check a label request against the moves only the loop makes: no stage label either way
 * on any issue, since a stage moves only through done, and no lifting an issue other than
 * the session's own out of triage.
 *
 * @param {number} target - The issue the request names.
 * @param {string[]} add - Labels to add.
 * @param {string[]} remove - Labels to remove.
 * @param {boolean} own - Whether the target is the session's own issue.
 * @returns {void}
 * @throws {Error} When the request would move an issue.
 */
function labelRules(target, add, remove, own) {
    for (const label of [...add, ...remove]) {
        if (label.startsWith("stage:")) {
            throw new Error(`label may not change ${label}; a stage moves through done`);
        }
    }
    if (!own && remove.includes("triage")) {
        throw new Error(`label may not lift issue ${target} out of triage`);
    }
}

/**
 * Check that a request body is an object.
 *
 * @param {string} kind - The request kind, for the error message.
 * @param {unknown} body - The request body.
 * @returns {Record<string, unknown>} The body.
 * @throws {Error} When the body is not an object.
 */
function objectBody(kind, body) {
    if (!isObject(body)) {
        throw new Error(`${kind} must be an object`);
    }
    return body;
}

/**
 * Check a note request.
 *
 * @param {unknown} body - The request body.
 * @returns {NoteRequest} The normalised request.
 * @throws {Error} When the note is not a non-empty string.
 */
function checkNote(body) {
    if (typeof body !== "string" || body.trim() === "") {
        throw new Error("note must be a non-empty string");
    }
    return {kind: "note", text: body};
}

/**
 * Check a wait request; only a session that works on an issue may wait.
 *
 * @param {unknown} body - The request body.
 * @param {number} issue - The session's issue, 0 when it has none.
 * @returns {WaitRequest} The normalised request.
 * @throws {Error} When the session has no issue or the reason is not a non-empty string.
 */
function checkWait(body, issue) {
    if (issue === 0) {
        throw new Error("wait needs a session that works on an issue");
    }
    if (typeof body !== "string" || body.trim() === "") {
        throw new Error("wait must be a non-empty string: what a person is to do");
    }
    return {kind: "wait", reason: body};
}

/**
 * Check a done request: it moves only the session's own issue, to an allowed target.
 *
 * @param {unknown} body - The request body.
 * @param {number} issue - The session's issue.
 * @returns {DoneRequest} The normalised request.
 * @throws {Error} When the body, the issue or the target is not allowed.
 */
function checkDone(body, issue) {
    const done = objectBody("done", body);
    if (done.issue !== issue) {
        throw new Error(
            `done may only move this session's issue ${issue}, not issue ${done.issue}`
        );
    }
    if (typeof done.to !== "string" || !DONE_TARGETS.includes(done.to)) {
        throw new Error(`done target ${done.to} is not one of ${DONE_TARGETS.join(", ")}`);
    }
    return {kind: "done", issue, to: done.to};
}

/**
 * Check a label request: known labels only, and none of the moves only the loop makes.
 *
 * @param {unknown} body - The request body.
 * @param {number} issue - The session's issue.
 * @returns {LabelRequest} The normalised request.
 * @throws {Error} When the body, the issue or a label is not allowed.
 */
function checkLabel(body, issue) {
    const request = objectBody("label", body);
    if (!isIssue(request.issue)) {
        throw new Error("label needs an issue number");
    }
    const add = labelList(request.add, "add");
    const remove = labelList(request.remove, "remove");
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
    labelRules(request.issue, add, remove, request.issue === issue);
    return {kind: "label", issue: request.issue, add, remove};
}

/**
 * Check a spawn request: a known persona, a prompt, and optionally an issue and a harness.
 *
 * @param {unknown} body - The request body.
 * @returns {SpawnRequest} The normalised request.
 * @throws {Error} When the body or one of its fields is not allowed.
 */
function checkSpawn(body) {
    const request = objectBody("spawn", body);
    if (typeof request.persona !== "string" || !PERSONAS.includes(request.persona)) {
        throw new Error(`spawn needs a persona, one of ${PERSONAS.join(", ")}`);
    }
    if (typeof request.prompt !== "string" || request.prompt.trim() === "") {
        throw new Error("spawn needs a non-empty prompt");
    }
    /** @type {SpawnRequest} */
    const spawn = {kind: "spawn", persona: request.persona, prompt: request.prompt};
    if (request.issue !== undefined) {
        if (!isIssue(request.issue)) {
            throw new Error("spawn issue must be an issue number");
        }
        spawn.issue = request.issue;
    }
    if (request.harness !== undefined) {
        if (typeof request.harness !== "string" || !HARNESSES.includes(request.harness)) {
            throw new Error(
                `spawn harness ${request.harness} is not one of ${HARNESSES.join(", ")}`
            );
        }
        spawn.harness = request.harness;
    }
    return spawn;
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
    switch (kind) {
        case "note":
            return checkNote(body);
        case "wait":
            return checkWait(body, issue);
        case "done":
            return checkDone(body, issue);
        case "label":
            return checkLabel(body, issue);
        case "spawn":
            return checkSpawn(body);
        default:
            throw new Error(`unknown request kind ${kind}`);
    }
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
