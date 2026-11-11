import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {scratch, adapter, runArgs, usageOf} from "./harness-adapter.js";

describe("codex adapter", () => {
    test("codex: run writes the thread id and usage, and passes the prompt on stdin", () => {
        const out = scratch();
        const args = path.join(out, "args");
        const stdin = path.join(out, "stdin");
        const r = adapter("codex", runArgs(out), {FAKE_ARGS: args, FAKE_STDIN: stdin});
        assert.equal(r.status, 0, r.stderr);
        assert.equal(
            fs.readFileSync(path.join(out, "session"), "utf8").trim(),
            "01a168dc-712c-7cc1-82fc-6f3dfe62bcf2"
        );
        assert.deepEqual(usageOf(out), {
            tokensIn: 40,
            tokensOut: 20,
            cacheRead: 60,
            cacheWrite: 0,
            costUsd: 0,
            turns: 2,
            status: "ok"
        });
        const line = fs.readFileSync(args, "utf8");
        assert.match(
            line,
            /^exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox /
        );
        assert.match(line, new RegExp(`-C ${out} `));
        assert.match(line, / -m m /);
        assert.match(line, / -$/m);
        const prompt = fs.readFileSync(stdin, "utf8");
        assert.ok(prompt.startsWith("This harness has no edit hook."));
        assert.ok(prompt.endsWith("hello"));
    });

    test("codex: the log is readable and the stream is saved", () => {
        const out = scratch();
        const r = adapter("codex", runArgs(out));
        assert.match(r.stdout, /▶ command: bash -lc ls/);
        assert.match(r.stdout, /hello from fake/);
        assert.match(r.stdout, /■ done/);
        assert.match(fs.readFileSync(path.join(out, "stream.jsonl"), "utf8"), /thread\.started/);
    });

    test("codex: resume continues the thread and replaces usage.json", () => {
        const out = scratch();
        adapter("codex", runArgs(out));
        const args = path.join(out, "args");
        const stdin = path.join(out, "stdin");
        const r = adapter(
            "codex",
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
            {FAKE_ARGS: args, FAKE_STDIN: stdin}
        );
        assert.equal(r.status, 0, r.stderr);
        assert.match(fs.readFileSync(args, "utf8"), / resume abc-123 -$/m);
        assert.equal(fs.readFileSync(stdin, "utf8"), "fix the lint");
        assert.equal(usageOf(out).tokensIn, 40);
        assert.equal(fs.readFileSync(path.join(out, "session"), "utf8").trim(), "abc-123");
    });

    test("codex: a usage limit is rate-limited and exits 75", () => {
        const out = scratch();
        const r = adapter("codex", runArgs(out), {FAKE_MODE: "ratelimit"});
        assert.equal(r.status, 75);
        assert.equal(usageOf(out).status, "rate-limited");
        assert.equal(usageOf(out).limit, "You have hit your usage limit. Try again at 3pm.");
    });

    test("codex: a failed turn is an error", () => {
        const out = scratch();
        const r = adapter("codex", runArgs(out), {FAKE_MODE: "failed"});
        assert.equal(r.status, 1);
        assert.equal(usageOf(out).status, "error");
    });

    test("codex: no completed turn is an error", () => {
        const out = scratch();
        adapter("codex", runArgs(out), {FAKE_MODE: "noturn"});
        assert.equal(usageOf(out).status, "error");
    });

    test("codex: a missing allow file exits 64", () => {
        const out = scratch();
        fs.rmSync(path.join(out, "allow.txt"));
        assert.equal(adapter("codex", runArgs(out)).status, 64);
    });
});
