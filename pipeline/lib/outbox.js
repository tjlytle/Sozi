/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reading what a session left in its outbox without trusting it: the session could
// write any file there, so only regular files are read (never a symlink or a named
// pipe), and only up to a size cap. The result file and the log tail live here; the
// request files are checked in requests.js.

import fs from "node:fs";
import path from "node:path";

const MAX_RESULT_BYTES = 256 * 1024;
const LOG_TAIL_BYTES = 64 * 1024;
const LOG_TAIL_LINES = 20;
const USAGE_STATUSES = ["ok", "error", "rate-limited", "auth", "budget", "unsupported"];
const HOOKS = ["ok", "error", "skipped"];
const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const NON_BLOCK = fs.constants.O_NONBLOCK ?? 0;

/**
 * @typedef {object} Usage
 * @property {number} tokensIn - Input tokens.
 * @property {number} tokensOut - Output tokens.
 * @property {number} costUsd - Cost in US dollars.
 * @property {number} turns - Conversation turns.
 * @property {string} status - How the usage report ended.
 */

/**
 * @typedef {object} Result
 * @property {number} exit - The session's exit code.
 * @property {string | null} session - The harness session id.
 * @property {Usage} usage - Usage totals.
 * @property {string[]} changed - Files changed.
 * @property {string[]} commits - Commits made.
 * @property {number} resumes - How many times the session was resumed.
 * @property {"ok" | "error" | "skipped"} hooks - Whether the outside hooks ran: "error" when they crashed, "skipped" when they never ran.
 */

/**
 * Open a regular file of the outbox for reading, never following a symlink and never
 * waiting on a named pipe.
 *
 * @param {string} file - The path.
 * @returns {{fd: number, size: number} | {refused: string}} The open file and its size, or why not.
 */
function openRegular(file) {
    let stat;
    try {
        stat = fs.lstatSync(file);
    } catch {
        return {refused: "missing"};
    }
    if (!stat.isFile()) {
        return {refused: "not a regular file"};
    }
    let fd;
    try {
        fd = fs.openSync(file, fs.constants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
    } catch {
        return {refused: "not a regular file"};
    }
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()) {
        fs.closeSync(fd);
        return {refused: "not a regular file"};
    }
    return {fd, size: opened.size};
}

/**
 * Read bytes of an open file from a position.
 *
 * @param {number} fd - The file descriptor; closed afterwards.
 * @param {number} position - Where to start.
 * @param {number} length - How many bytes at most.
 * @returns {string} The bytes as UTF-8.
 */
function readAt(fd, position, length) {
    try {
        const buffer = Buffer.alloc(length);
        const n = fs.readSync(fd, buffer, 0, length, position);
        return buffer.subarray(0, n).toString("utf8");
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * Read a regular file of the outbox whole, when it is at most a size.
 *
 * @param {string} file - The path.
 * @param {number} cap - The largest size read, in bytes.
 * @returns {{text: string} | {refused: string}} The text, or why it was not read.
 */
export function readBounded(file, cap) {
    const open = openRegular(file);
    if ("refused" in open) {
        return open;
    }
    if (open.size > cap) {
        fs.closeSync(open.fd);
        return {refused: "too large"};
    }
    return {text: readAt(open.fd, 0, open.size)};
}

/**
 * The last lines of a session's log, read from its end only.
 *
 * @param {string} outbox - The outbox directory.
 * @returns {string} Up to twenty lines, or a note that there is no log.
 */
export function logTail(outbox) {
    const open = openRegular(path.join(outbox, "log"));
    if ("refused" in open) {
        return "(no log)";
    }
    const length = Math.min(open.size, LOG_TAIL_BYTES);
    const text = readAt(open.fd, open.size - length, length);
    return text.trimEnd().split("\n").slice(-LOG_TAIL_LINES).join("\n");
}

/**
 * @param {unknown} value - A value from the file.
 * @returns {value is Record<string, unknown>} Whether it is a plain object.
 */
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the result.json the stage runner wrote, filling in defaults; `hooks` is "ok"
 * unless the runner wrote "error" or "skipped".
 *
 * @param {string} dir - The outbox directory.
 * @param {{log?: (line: string) => void}} [options] - Where to say why a file was not read.
 * @returns {Result | null} The result, or null when the file is missing, not a regular
 *     file, over 256 KiB or not JSON.
 */
export function readResult(dir, {log = () => {}} = {}) {
    const read = readBounded(path.join(dir, "result.json"), MAX_RESULT_BYTES);
    if ("refused" in read) {
        if (read.refused !== "missing") {
            log(`result.json refused: ${read.refused}`);
        }
        return null;
    }
    let raw;
    try {
        raw = JSON.parse(read.text);
    } catch {
        return null;
    }
    if (!isObject(raw)) {
        return null;
    }
    const u = isObject(raw.usage) ? raw.usage : {};
    /**
     * @param {unknown} v - A usage value.
     * @returns {number} The value if finite, else 0.
     */
    const num = v => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    /**
     * @param {unknown} v - A list from the file.
     * @returns {string[]} Its string elements.
     */
    const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
    return {
        exit: Number.isInteger(raw.exit) ? /** @type {number} */ (raw.exit) : 1,
        session: typeof raw.session === "string" ? raw.session : null,
        usage: {
            tokensIn: num(u.tokensIn),
            tokensOut: num(u.tokensOut),
            costUsd: num(u.costUsd),
            turns: num(u.turns),
            status:
                typeof u.status === "string" && USAGE_STATUSES.includes(u.status)
                    ? u.status
                    : "error"
        },
        changed: strings(raw.changed),
        commits: strings(raw.commits),
        resumes:
            Number.isInteger(raw.resumes) && /** @type {number} */ (raw.resumes) >= 0
                ? /** @type {number} */ (raw.resumes)
                : 0,
        hooks: HOOKS.includes(/** @type {string} */ (raw.hooks))
            ? /** @type {Result["hooks"]} */ (raw.hooks)
            : "ok"
    };
}
