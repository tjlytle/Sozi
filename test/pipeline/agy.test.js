import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {scratch, adapter, runArgs, resumeArgs, recorded, usageOf} from "./harness-adapter.js";

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

    // The recorded streams report usage per thread: the resume's result holds both calls
    // (input 12,197, cache read 7,881, output 10, num_turns 2).
    test("agy: resume over the recorded streams reports the session total", () => {
        const out = scratch();
        adapter("agy", runArgs(out), {FAKE_STREAM: recorded("agy-run.jsonl")});
        const r = adapter("agy", resumeArgs(out, "abc-123"), {
            FAKE_STREAM: recorded("agy-resume.jsonl")
        });
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(usageOf(out), {
            tokensIn: 12197,
            tokensOut: 10,
            cacheRead: 7881,
            cacheWrite: 0,
            costUsd: 0,
            turns: 2,
            status: "ok"
        });
    });

    test("agy: a rate-limited resume keeps the session's totals and exits 75", () => {
        const out = scratch();
        adapter("agy", runArgs(out), {FAKE_STREAM: recorded("agy-run.jsonl")});
        const r = adapter("agy", resumeArgs(out, "abc-123"), {FAKE_MODE: "ratelimit"});
        assert.equal(r.status, 75);
        const usage = usageOf(out);
        assert.equal(usage.status, "rate-limited");
        assert.equal(usage.tokensIn, 9935);
        assert.equal(usage.tokensOut, 20);
        assert.equal(usage.turns, 2);
    });

    test("agy: resume over a usage.json that is not JSON counts from zero", () => {
        const out = scratch();
        fs.writeFileSync(path.join(out, "usage.json"), "not json");
        const r = adapter("agy", resumeArgs(out, "abc-123"), {
            FAKE_STREAM: recorded("agy-resume.jsonl")
        });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(usageOf(out).tokensIn, 12197);
        assert.equal(usageOf(out).turns, 2);
    });

    test("agy: run ignores an existing usage.json", () => {
        const out = scratch();
        fs.writeFileSync(
            path.join(out, "usage.json"),
            JSON.stringify({tokensIn: 99999, cacheRead: 99999, tokensOut: 99999, turns: 9})
        );
        adapter("agy", runArgs(out), {FAKE_STREAM: recorded("agy-run.jsonl")});
        assert.equal(usageOf(out).tokensIn, 9935);
        assert.equal(usageOf(out).cacheRead, 0);
        assert.equal(usageOf(out).tokensOut, 5);
        assert.equal(usageOf(out).turns, 1);
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
