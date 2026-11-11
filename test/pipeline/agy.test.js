import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {scratch, adapter, runArgs, usageOf} from "./harness-adapter.js";

describe("agy adapter", () => {
    test("agy: run writes the conversation id and usage, and passes the prompt", () => {
        const out = scratch();
        const args = path.join(out, "args");
        const r = adapter("agy", runArgs(out), {FAKE_ARGS: args});
        assert.equal(r.status, 0, r.stderr);
        assert.equal(
            fs.readFileSync(path.join(out, "session"), "utf8").trim(),
            "ab168d05-1b6a-41bc-b545-d843922f1f70"
        );
        assert.deepEqual(usageOf(out), {
            tokensIn: 100,
            tokensOut: 20,
            cacheRead: 30,
            cacheWrite: 0,
            costUsd: 0,
            turns: 3,
            status: "ok"
        });
        const line = fs.readFileSync(args, "utf8");
        assert.ok(line.startsWith("-p This harness has no edit hook."));
        assert.match(
            line,
            /hello --output-format stream-json --model m --dangerously-skip-permissions --add-dir /
        );
    });

    test("agy: the log is readable and the stream is saved", () => {
        const out = scratch();
        const r = adapter("agy", runArgs(out));
        assert.match(r.stdout, /▶ run_command: ls/);
        assert.match(r.stdout, /hello from fake/);
        assert.match(r.stdout, /■ SUCCESS after 3 turns/);
        assert.match(fs.readFileSync(path.join(out, "stream.jsonl"), "utf8"), /"event":"init"/);
    });

    test("agy: resume passes --conversation and the message", () => {
        const out = scratch();
        const args = path.join(out, "args");
        const r = adapter(
            "agy",
            [
                "resume",
                "--session",
                "abc-123",
                "--message",
                path.join(out, "message.md"),
                "--model",
                "m",
                "--allow",
                path.join(out, "allow.txt"),
                "--checkout",
                out,
                "--out",
                out
            ],
            {FAKE_ARGS: args}
        );
        assert.equal(r.status, 0, r.stderr);
        const line = fs.readFileSync(args, "utf8");
        assert.match(line, /^-p fix the lint /);
        assert.match(line, / --conversation abc-123/);
    });

    test("agy: a quota error is rate-limited and exits 75", () => {
        const out = scratch();
        const r = adapter("agy", runArgs(out), {FAKE_MODE: "ratelimit"});
        assert.equal(r.status, 75);
        assert.equal(usageOf(out).status, "rate-limited");
        assert.equal(usageOf(out).limit, "RESOURCE_EXHAUSTED: quota exceeded (429)");
    });

    test("agy: a failed result is an error", () => {
        const out = scratch();
        const r = adapter("agy", runArgs(out), {FAKE_MODE: "failed"});
        assert.equal(r.status, 1);
        assert.equal(usageOf(out).status, "error");
    });

    test("agy: no result event is an error", () => {
        const out = scratch();
        adapter("agy", runArgs(out), {FAKE_MODE: "noresult"});
        assert.equal(usageOf(out).status, "error");
    });

    test("agy: a missing allow file exits 64", () => {
        const out = scratch();
        fs.rmSync(path.join(out, "allow.txt"));
        assert.equal(adapter("agy", runArgs(out)).status, 64);
    });
});
