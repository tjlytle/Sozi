import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
const fake = path.join(root, "test/fixtures/pipeline/fake-claude");

/**
 * A scratch dir holding prompt.md, allow.txt and message.md.
 * @returns {string} the dir
 */
function scratch() {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-"));
    fs.writeFileSync(path.join(out, "prompt.md"), "hello");
    fs.writeFileSync(path.join(out, "message.md"), "fix the lint");
    fs.writeFileSync(path.join(out, "allow.txt"), "# comment\nRead\n\nBash(npm *)\n");
    return out;
}

/**
 * Run an adapter with the fake claude.
 * @param {string} name adapter name
 * @param {string[]} args arguments after the adapter path
 * @param {Record<string, string>} env extra environment
 * @returns {import("node:child_process").SpawnSyncReturns<string>} the finished process
 */
function adapter(name, args, env = {}) {
    /** @type {Record<string, string | undefined>} */
    const e = {...process.env, CLAUDE_BIN: fake};
    delete e.PIPELINE_SESSION_BUDGET_USD;
    Object.assign(e, env);
    return spawnSync("bash", [path.join(root, `pipeline/harness/${name}`), ...args], {
        env: e,
        encoding: "utf8"
    });
}

/**
 * The arguments for a claude run in dir.
 * @param {string} dir scratch dir
 * @returns {string[]} the arguments
 */
function runArgs(dir) {
    return [
        "run",
        "--prompt",
        path.join(dir, "prompt.md"),
        "--model",
        "m",
        "--allow",
        path.join(dir, "allow.txt"),
        "--checkout",
        dir,
        "--out",
        dir
    ];
}

/**
 * The arguments for a claude resume of the session run in dir.
 * @param {string} dir scratch dir holding the session file
 * @returns {string[]} the arguments
 */
function resumeArgs(dir) {
    return [
        "resume",
        "--session",
        fs.readFileSync(path.join(dir, "session"), "utf8").trim(),
        "--message",
        path.join(dir, "message.md"),
        "--model",
        "m",
        "--allow",
        path.join(dir, "allow.txt"),
        "--checkout",
        dir,
        "--out",
        dir
    ];
}

/**
 * Parse usage.json in dir.
 * @param {string} dir scratch dir
 * @returns {any} the parsed usage
 */
function usageOf(dir) {
    return JSON.parse(fs.readFileSync(path.join(dir, "usage.json"), "utf8"));
}

describe("harness adapters", () => {
    test("claude: run writes session and usage from the stream", () => {
        const out = scratch();
        const args = path.join(out, "args");
        const r = adapter("claude", runArgs(out), {FAKE_ARGS: args});
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(usageOf(out), {
            tokensIn: 100,
            tokensOut: 20,
            costUsd: 0.12,
            turns: 3,
            status: "ok"
        });
        assert.match(fs.readFileSync(path.join(out, "session"), "utf8"), /^[0-9a-f-]{36}\n?$/);
        const seen = fs.readFileSync(args, "utf8");
        assert.match(seen, /--allowedTools Read Bash\(npm \*\)\s*$/);
        assert.match(seen, /--permission-mode acceptEdits/);
        assert.match(seen, /--session-id [0-9a-f-]{36}/);
        assert.doesNotMatch(seen, /--max-budget-usd/);
    });

    test("claude: the stream is saved and the log is readable", () => {
        const out = scratch();
        const r = adapter("claude", runArgs(out), {FAKE_ARGS: path.join(out, "args")});
        assert.match(r.stdout, /hello from fake/);
        assert.match(r.stdout, /■ success after 3 turns/);
        assert.match(fs.readFileSync(path.join(out, "stream.jsonl"), "utf8"), /"type":"result"/);
    });

    test("claude: resume passes --resume and the message, and counts from an empty usage.json", () => {
        const out = scratch();
        const args = path.join(out, "args");
        adapter("claude", runArgs(out), {FAKE_ARGS: args});
        const id = fs.readFileSync(path.join(out, "session"), "utf8").trim();
        fs.writeFileSync(path.join(out, "usage.json"), "{}");
        const r = adapter("claude", resumeArgs(out), {FAKE_ARGS: args});
        assert.equal(r.status, 0, r.stderr);
        const lines = fs.readFileSync(args, "utf8").trim().split("\n");
        assert.equal(lines.length, 2);
        assert.ok(lines[1].startsWith("-p fix the lint "), lines[1]);
        assert.ok(lines[1].includes(`--resume ${id}`), lines[1]);
        for (const line of lines) {
            assert.ok(line.includes(`--add-dir ${fs.realpathSync(out)}`), line);
        }
        assert.ok(!lines[1].includes("--session-id"));
        assert.deepEqual(usageOf(out), {
            tokensIn: 100,
            tokensOut: 20,
            costUsd: 0.12,
            turns: 3,
            status: "ok"
        });
    });

    test("claude: resume sums tokens and turns and takes the cost as reported", () => {
        const out = scratch();
        adapter("claude", runArgs(out));
        const r = adapter("claude", resumeArgs(out), {FAKE_COST: "0.30"});
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(usageOf(out), {
            tokensIn: 200,
            tokensOut: 40,
            costUsd: 0.3,
            turns: 6,
            status: "ok"
        });
    });

    test("claude: a rate-limited resume sums the totals and exits 75", () => {
        const out = scratch();
        adapter("claude", runArgs(out));
        const r = adapter("claude", resumeArgs(out), {FAKE_MODE: "ratelimit"});
        assert.equal(r.status, 75);
        assert.deepEqual(usageOf(out), {
            tokensIn: 200,
            tokensOut: 40,
            costUsd: 0.12,
            turns: 6,
            status: "rate-limited"
        });
    });

    test("claude: resume over a usage.json that is not JSON counts from zero", () => {
        const out = scratch();
        adapter("claude", runArgs(out));
        fs.writeFileSync(path.join(out, "usage.json"), "not json");
        const r = adapter("claude", resumeArgs(out));
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(usageOf(out), {
            tokensIn: 100,
            tokensOut: 20,
            costUsd: 0.12,
            turns: 3,
            status: "ok"
        });
    });

    test("claude: run ignores an existing usage.json", () => {
        const out = scratch();
        fs.writeFileSync(
            path.join(out, "usage.json"),
            '{"tokensIn":5,"tokensOut":5,"costUsd":9,"turns":5,"status":"ok"}'
        );
        adapter("claude", runArgs(out));
        assert.deepEqual(usageOf(out), {
            tokensIn: 100,
            tokensOut: 20,
            costUsd: 0.12,
            turns: 3,
            status: "ok"
        });
    });

    test("claude: rate limit exits 75", () => {
        const out = scratch();
        const r = adapter("claude", runArgs(out), {FAKE_MODE: "ratelimit"});
        assert.equal(r.status, 75);
        assert.equal(usageOf(out).status, "rate-limited");
    });

    test("claude: a subscription usage limit is rate-limited and exits 75", () => {
        const out = scratch();
        const r = adapter("claude", runArgs(out), {FAKE_MODE: "usagelimit"});
        assert.equal(r.status, 75);
        assert.equal(usageOf(out).status, "rate-limited");
    });

    test("claude: budget status", () => {
        const out = scratch();
        adapter("claude", runArgs(out), {FAKE_MODE: "budget"});
        assert.equal(usageOf(out).status, "budget");
    });

    test("claude: no result line is an error", () => {
        const out = scratch();
        const r = adapter("claude", runArgs(out), {FAKE_MODE: "noresult"});
        assert.equal(r.status, 0);
        assert.equal(usageOf(out).status, "error");
    });

    test("claude: a missing --prompt exits 64", () => {
        const out = scratch();
        const a = runArgs(out);
        a.splice(1, 2);
        const r = adapter("claude", a);
        assert.equal(r.status, 64);
        assert.match(r.stderr, /Usage/);
    });

    test("claude: an unknown flag exits 64", () => {
        const out = scratch();
        const r = adapter("claude", [...runArgs(out), "--bogus", "x"]);
        assert.equal(r.status, 64);
    });

    test("claude: --max-budget-usd only when the budget is set", () => {
        const out = scratch();
        const args = path.join(out, "args");
        adapter("claude", runArgs(out), {FAKE_ARGS: args, PIPELINE_SESSION_BUDGET_USD: "2"});
        assert.match(fs.readFileSync(args, "utf8"), /--max-budget-usd 2/);
        const out2 = scratch();
        const args2 = path.join(out2, "args");
        adapter("claude", runArgs(out2), {FAKE_ARGS: args2, PIPELINE_SESSION_BUDGET_USD: "0"});
        assert.doesNotMatch(fs.readFileSync(args2, "utf8"), /--max-budget-usd/);
    });

    test("claude: --plugin-dir only when the directory exists", () => {
        const out = scratch();
        const args = path.join(out, "args");
        adapter("claude", runArgs(out), {FAKE_ARGS: args, PLUGIN_DIR: path.join(out, "nope")});
        assert.doesNotMatch(fs.readFileSync(args, "utf8"), /--plugin-dir/);
        fs.mkdirSync(path.join(out, "plugin"));
        const args2 = path.join(out, "args2");
        adapter("claude", runArgs(out), {FAKE_ARGS: args2, PLUGIN_DIR: path.join(out, "plugin")});
        assert.match(fs.readFileSync(args2, "utf8"), /--plugin-dir .*plugin/);
    });

    test("claude: a success that mentions 429 and rate limit stays ok", () => {
        const out = scratch();
        const r = adapter("claude", runArgs(out), {FAKE_MODE: "mention"});
        assert.equal(r.status, 0, r.stderr);
        assert.equal(usageOf(out).status, "ok");
    });

    test("claude: a missing allow file exits 64", () => {
        const out = scratch();
        const a = runArgs(out);
        a[a.indexOf("--allow") + 1] = path.join(out, "nope.txt");
        assert.equal(adapter("claude", a).status, 64);
    });

    test("claude: an allow file with no rules omits --allowedTools and keeps it last otherwise", () => {
        const out = scratch();
        fs.writeFileSync(path.join(out, "allow.txt"), "# only a comment\n  \n");
        const args = path.join(out, "args");
        assert.equal(adapter("claude", runArgs(out), {FAKE_ARGS: args}).status, 0);
        assert.doesNotMatch(fs.readFileSync(args, "utf8"), /--allowedTools/);
        const out2 = scratch();
        const args2 = path.join(out2, "args");
        fs.writeFileSync(
            path.join(out2, "allow.txt"),
            "  Read \r\n  # indented comment\nBash(npm *)\r\n"
        );
        adapter("claude", runArgs(out2), {FAKE_ARGS: args2, PIPELINE_SESSION_BUDGET_USD: "2"});
        const seen = fs.readFileSync(args2, "utf8").trim();
        assert.ok(seen.endsWith("--allowedTools Read Bash(npm *)"), seen);
    });

    test("claude: relative paths still work after the cd", () => {
        const out = scratch();
        const sub = path.join(out, "sub");
        fs.mkdirSync(sub);
        const r = spawnSync(
            "bash",
            [
                path.join(root, "pipeline/harness/claude"),
                "run",
                "--prompt",
                "prompt.md",
                "--model",
                "m",
                "--allow",
                "allow.txt",
                "--checkout",
                "sub",
                "--out",
                "o"
            ],
            {
                cwd: out,
                env: {...process.env, CLAUDE_BIN: fake},
                encoding: "utf8"
            }
        );
        assert.equal(r.status, 0, r.stderr);
        assert.equal(usageOf(path.join(out, "o")).status, "ok");
    });

    test("claude: resume does not reuse an old result, and keeps the session's totals", () => {
        const out = scratch();
        adapter("claude", runArgs(out));
        const r = adapter("claude", resumeArgs(out), {FAKE_MODE: "noresult"});
        assert.equal(r.status, 0);
        assert.deepEqual(usageOf(out), {
            tokensIn: 100,
            tokensOut: 20,
            costUsd: 0.12,
            turns: 3,
            status: "error"
        });
    });

    test("claude: the prompt reaches the CLI verbatim", () => {
        const out = scratch();
        const prompt = 'cost is $HOME and `id` and "quoted" \\ done';
        fs.writeFileSync(path.join(out, "prompt.md"), prompt);
        const args = path.join(out, "args");
        adapter("claude", runArgs(out), {FAKE_ARGS: args});
        assert.ok(fs.readFileSync(args, "utf8").startsWith(`-p ${prompt} `));
    });

    test("stubs exit 69 and say so", () => {
        for (const name of ["codex", "opencode"]) {
            const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-"));
            const r = adapter(name, [
                "run",
                "--prompt",
                "p",
                "--model",
                "m",
                "--allow",
                "a",
                "--checkout",
                out,
                "--out",
                out
            ]);
            assert.equal(r.status, 69);
            assert.match(r.stdout, new RegExp(`${name} adapter is a stub`));
            assert.deepEqual(usageOf(out), {
                tokensIn: 0,
                tokensOut: 0,
                costUsd: 0,
                turns: 0,
                status: "unsupported"
            });
        }
    });

    test("stubs exit 64 on a wrong call", () => {
        for (const name of ["codex", "opencode"]) {
            assert.equal(adapter(name, ["run", "--out", os.tmpdir()]).status, 64);
        }
    });
});
