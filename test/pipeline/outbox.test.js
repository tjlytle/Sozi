/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// test/pipeline/outbox.test.js: reading what a session left without trusting it.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {logTail, readResult} from "../../pipeline/lib/outbox.js";
import {readRequests} from "../../pipeline/lib/requests.js";

/**
 * Make a scratch directory.
 * @returns {string} The directory path.
 */
function scratch() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "outbox-test-"));
}

/**
 * Make a named pipe, when the platform has mkfifo.
 * @param {string} file - The path.
 * @returns {boolean} Whether it was made.
 */
function fifo(file) {
    return spawnSync("mkfifo", [file]).status === 0;
}

const RESULT = JSON.stringify({exit: 0, usage: {status: "ok"}, hooks: "ok"});

describe("request files", () => {
    test("a named pipe is refused without blocking", t => {
        const dir = scratch();
        if (!fifo(path.join(dir, "req-1.json"))) {
            t.skip("no mkfifo here");
            return;
        }
        const {accepted, refused} = readRequests(dir, {issue: 25});
        assert.deepEqual(accepted, []);
        assert.deepEqual(refused, [{file: "req-1.json", reason: "not a regular file"}]);
    });
    test("a symlink is refused, even to a valid request", () => {
        const dir = scratch();
        const target = path.join(scratch(), "real.json");
        fs.writeFileSync(target, JSON.stringify({note: "hi"}));
        fs.symlinkSync(target, path.join(dir, "req-1.json"));
        assert.deepEqual(readRequests(dir, {issue: 25}).refused, [
            {file: "req-1.json", reason: "not a regular file"}
        ]);
    });
    test("a file over 16 KiB is refused as too large", () => {
        const dir = scratch();
        fs.writeFileSync(path.join(dir, "req-1.json"), JSON.stringify({note: "x".repeat(17000)}));
        fs.writeFileSync(path.join(dir, "req-2.json"), JSON.stringify({note: "y".repeat(16000)}));
        const {accepted, refused} = readRequests(dir, {issue: 25});
        assert.deepEqual(refused, [{file: "req-1.json", reason: "too large"}]);
        assert.equal(accepted.length, 1);
    });
});

describe("result.json", () => {
    test("a symlink or a named pipe gives no result", t => {
        const dir = scratch();
        const target = path.join(scratch(), "result.json");
        fs.writeFileSync(target, RESULT);
        fs.symlinkSync(target, path.join(dir, "result.json"));
        assert.equal(readResult(dir), null);
        const pipe = scratch();
        if (!fifo(path.join(pipe, "result.json"))) {
            t.skip("no mkfifo here");
            return;
        }
        assert.equal(readResult(pipe), null);
    });
    test("a result over 256 KiB gives no result, with a log line", () => {
        const dir = scratch();
        const big = JSON.stringify({exit: 0, changed: ["x".repeat(270 * 1024)]});
        fs.writeFileSync(path.join(dir, "result.json"), big);
        /** @type {string[]} */
        const lines = [];
        assert.equal(readResult(dir, {log: line => lines.push(line)}), null);
        assert.match(lines.join("\n"), /result\.json.*too large/);
    });
    test("an outside pass that never ran is kept as skipped", () => {
        const dir = scratch();
        fs.writeFileSync(
            path.join(dir, "result.json"),
            JSON.stringify({exit: 1, hooks: "skipped"})
        );
        assert.equal(readResult(dir)?.hooks, "skipped");
    });
});

describe("the log tail", () => {
    test("the last twenty lines of a long log, read from its end", () => {
        const dir = scratch();
        const lines = Array.from({length: 20000}, (_, i) => `line ${i}`);
        fs.writeFileSync(path.join(dir, "log"), lines.join("\n") + "\n");
        assert.equal(logTail(dir), lines.slice(-20).join("\n"));
    });
    test("a missing, linked or piped log gives no log", t => {
        const dir = scratch();
        assert.equal(logTail(dir), "(no log)");
        const target = path.join(scratch(), "secret");
        fs.writeFileSync(target, "do not show\n");
        fs.symlinkSync(target, path.join(dir, "log"));
        assert.equal(logTail(dir), "(no log)");
        const pipe = scratch();
        if (!fifo(path.join(pipe, "log"))) {
            t.skip("no mkfifo here");
            return;
        }
        assert.equal(logTail(pipe), "(no log)");
    });
});
