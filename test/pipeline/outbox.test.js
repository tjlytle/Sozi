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
import {copyCarry, logTail, readResult, writeNew} from "../../pipeline/lib/outbox.js";
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
    test("missing or malformed file gives null", () => {
        const dir = scratch();
        assert.equal(readResult(dir), null);
        fs.writeFileSync(path.join(dir, "result.json"), "{bad");
        assert.equal(readResult(dir), null);
    });
    test("a partial object gets defaults", () => {
        const dir = scratch();
        fs.writeFileSync(
            path.join(dir, "result.json"),
            JSON.stringify({exit: 0, usage: {turns: 4}, changed: ["a"]})
        );
        assert.deepEqual(readResult(dir), {
            exit: 0,
            session: null,
            usage: {
                tokensIn: 0,
                cacheRead: 0,
                cacheWrite: 0,
                tokensOut: 0,
                costUsd: 0,
                turns: 4,
                status: "error"
            },
            usageKnown: true,
            changed: ["a"],
            commits: [],
            resumes: 0,
            hooks: "ok"
        });
    });
    test("checks every field type and drops unknown keys", () => {
        const dir = scratch();
        fs.writeFileSync(
            path.join(dir, "result.json"),
            JSON.stringify({
                exit: "0",
                session: 7,
                extra: "x",
                usage: {tokensIn: "x", tokensOut: 5, costUsd: null, turns: 2, status: "weird"},
                changed: ["a", 3, "b"],
                commits: "abc",
                resumes: -1
            })
        );
        assert.deepEqual(readResult(dir), {
            exit: 1,
            session: null,
            usage: {
                tokensIn: 0,
                cacheRead: 0,
                cacheWrite: 0,
                tokensOut: 5,
                costUsd: 0,
                turns: 2,
                status: "error"
            },
            usageKnown: true,
            changed: ["a", "b"],
            commits: [],
            resumes: 0,
            hooks: "ok"
        });
        fs.writeFileSync(
            path.join(dir, "result.json"),
            JSON.stringify({usage: "lots", exit: 0, resumes: 2})
        );
        const result = readResult(dir);
        assert.equal(result?.usage.turns, 0);
        assert.equal(result?.usageKnown, false);
        assert.equal(result?.exit, 0);
        assert.equal(result?.resumes, 2);
        assert.equal(result?.hooks, "ok");
    });
    test("a crashed outside pass is kept and anything else defaults to ok", () => {
        const dir = scratch();
        fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({exit: 0, hooks: "error"}));
        assert.equal(readResult(dir)?.hooks, "error");
        fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({exit: 0, hooks: 5}));
        assert.equal(readResult(dir)?.hooks, "ok");
    });
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
    test("a result whose login failed is read with its auth status", () => {
        const dir = scratch();
        const usage = {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 1, status: "auth"};
        fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({exit: 1, usage}));
        assert.equal(readResult(dir)?.usage.status, "auth");
    });
    test("a carry that failed to apply is kept; any other carry value is dropped", () => {
        const dir = scratch();
        const file = path.join(dir, "result.json");
        fs.writeFileSync(file, JSON.stringify({exit: 1, carry: "failed"}));
        assert.equal(readResult(dir)?.carry, "failed");
        fs.writeFileSync(file, JSON.stringify({exit: 1, carry: "maybe"}));
        assert.equal(readResult(dir)?.carry, undefined);
    });
    test("branches are kept as a list of names; anything else is dropped", () => {
        const dir = scratch();
        const file = path.join(dir, "result.json");
        fs.writeFileSync(file, JSON.stringify({exit: 1, branches: ["25-a", "25-b"]}));
        assert.deepEqual(readResult(dir)?.branches, ["25-a", "25-b"]);
        for (const branches of [[], ["25-a", 3], "25-a", null, {a: 1}]) {
            fs.writeFileSync(file, JSON.stringify({exit: 1, branches}));
            assert.equal(readResult(dir)?.branches, undefined, JSON.stringify(branches));
        }
    });
    test("the cache counts are read, 0 when absent", () => {
        const dir = scratch();
        const usage = {tokensIn: 4, cacheRead: 136247, cacheWrite: 9933, status: "ok"};
        fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({exit: 0, usage}));
        const read = readResult(dir);
        assert.equal(read?.usage.cacheRead, 136247);
        assert.equal(read?.usage.cacheWrite, 9933);
        assert.equal(read?.usageKnown, true);
        fs.writeFileSync(path.join(dir, "result.json"), RESULT);
        assert.equal(readResult(dir)?.usage.cacheRead, 0);
        assert.equal(readResult(dir)?.usage.cacheWrite, 0);
    });
    test("a null usage is not known, and its status is error", () => {
        const dir = scratch();
        fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({exit: 1, usage: null}));
        const read = readResult(dir);
        assert.equal(read?.usageKnown, false);
        assert.equal(read?.usage.status, "error");
    });
});

describe("the log tail", () => {
    test("the last twenty lines of a long log, read from its end", () => {
        const dir = scratch();
        const lines = Array.from({length: 20000}, (_, i) => `line ${i}`);
        fs.writeFileSync(path.join(dir, "log"), lines.join("\n") + "\n");
        assert.equal(logTail(dir), lines.slice(-20).join("\n"));
    });
    test("a limit string is kept, capped at 300 characters; anything else is dropped", () => {
        const dir = scratch();
        /**
         * Read a result whose usage carries a limit value.
         * @param {unknown} limit - The value.
         * @returns {unknown} The limit read back.
         */
        const read = limit => {
            const usage = {status: "rate-limited", limit};
            fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({exit: 75, usage}));
            return readResult(dir)?.usage.limit;
        };
        assert.equal(read("resets 3pm"), "resets 3pm");
        assert.equal(read("x".repeat(400)), "x".repeat(300));
        assert.equal(read(42), undefined);
        assert.equal(read(undefined), undefined);
    });
    test("the carry files are copied when regular, never through a link", () => {
        const from = scratch();
        const to = scratch();
        fs.writeFileSync(path.join(from, "carry.bundle"), Buffer.from([0, 255, 1]));
        const secret = path.join(scratch(), "secret");
        fs.writeFileSync(secret, "do not copy");
        fs.symlinkSync(secret, path.join(from, "carry.patch"));
        copyCarry(from, to);
        assert.deepEqual([...fs.readFileSync(path.join(to, "carry.bundle"))], [0, 255, 1]);
        assert.equal(fs.existsSync(path.join(to, "carry.patch")), false);
        copyCarry(scratch(), to);
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

describe("writeNew", () => {
    test("writes the file, replacing a link left in its place or the temporary's", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wn-"));
        const target = path.join(dir, "elsewhere");
        fs.writeFileSync(target, "untouched");
        fs.symlinkSync(target, path.join(dir, "a-1.json"));
        fs.symlinkSync(target, path.join(dir, ".a-1.json.tmp"));
        assert.equal(writeNew(dir, "a-1.json", "{}"), true);
        assert.equal(fs.readFileSync(target, "utf8"), "untouched");
        assert.ok(fs.lstatSync(path.join(dir, "a-1.json")).isFile());
        assert.equal(fs.readFileSync(path.join(dir, "a-1.json"), "utf8"), "{}");
        assert.ok(!fs.existsSync(path.join(dir, ".a-1.json.tmp")));
    });

    test("writes nothing into a directory that is a link, or missing", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wn-"));
        const real = path.join(dir, "real");
        fs.mkdirSync(real);
        fs.symlinkSync(real, path.join(dir, "advise"));
        assert.equal(writeNew(path.join(dir, "advise"), "a-1.json", "{}"), false);
        assert.deepEqual(fs.readdirSync(real), []);
        assert.equal(writeNew(path.join(dir, "missing"), "a-1.json", "{}"), false);
    });
});
