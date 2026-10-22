import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
/** @type {string[]} */
const dirs = [];

const FAKE_HARNESS = `#!/usr/bin/env bash
out=""; checkout=""
while [ $# -gt 0 ]; do
    case "$1" in
        --out) out="$2"; shift ;;
        --checkout) checkout="$2"; shift ;;
    esac
    shift
done
echo "fake harness ran"
echo "fake-session-1" >"$out/session"
echo '{"tokensIn": 10, "tokensOut": 5, "costUsd": 0.25, "turns": 2, "status": "ok"}' >"$out/usage.json"
[ -n "\${FAKE_TOUCH:-}" ] && echo "changed" >"$checkout/$FAKE_TOUCH"
exit "\${FAKE_EXIT:-0}"
`;

const FAKE_HOOKS = `#!/usr/bin/env bash
echo "called" >>"$HOOKS_LOG"
: >"$3"
exit 0
`;

const RESUMING_HOOKS = `#!/usr/bin/env bash
echo "called" >>"$HOOKS_LOG"
if [ "$(wc -l <"$HOOKS_LOG")" -eq 1 ]; then echo "fix it" >"$3"; exit 1; fi
: >"$3"
`;

/**
 * Build a scratch world for one stage run: mirror, outbox, cache and fake scripts.
 * @returns {{tmp: string, outbox: string, env: Record<string, string>}} - The paths and the environment.
 */
function world() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stage-run-"));
    dirs.push(tmp);
    execFileSync("git", ["clone", "-q", "--bare", "--shared", root, path.join(tmp, "mirror.git")]);
    const harnessDir = path.join(tmp, "harness");
    fs.mkdirSync(harnessDir);
    fs.writeFileSync(path.join(harnessDir, "fake"), FAKE_HARNESS, {mode: 0o755});
    const hooks = path.join(tmp, "hooks.sh");
    fs.writeFileSync(hooks, FAKE_HOOKS, {mode: 0o755});
    const outbox = path.join(tmp, "outbox");
    fs.mkdirSync(outbox);
    fs.writeFileSync(path.join(outbox, "prompt.md"), "do the thing\n");
    fs.writeFileSync(path.join(outbox, "allow.txt"), "Read\n");
    const cache = path.join(tmp, "cache");
    fs.mkdirSync(cache);
    const lock = execFileSync("git", ["show", "master:package-lock.json"], {
        cwd: root,
        maxBuffer: 1 << 28
    });
    fs.writeFileSync(
        path.join(cache, "lock-sha"),
        crypto.createHash("sha256").update(lock).digest("hex") + "\n"
    );
    fs.symlinkSync(path.join(root, "node_modules"), path.join(cache, "node_modules"));
    return {
        tmp,
        outbox,
        env: {
            ...process.env,
            PIPELINE_REPO: "tjlytle/Sozi",
            PIPELINE_HARNESS: "fake",
            PIPELINE_MODEL: "m",
            PIPELINE_OFFLINE: "1",
            MIRROR: path.join(tmp, "mirror.git"),
            OUTBOX: outbox,
            WORK: path.join(tmp, "work"),
            CACHE: cache,
            HARNESS_DIR: harnessDir,
            HOOKS_OUTSIDE: hooks,
            HOOKS_LOG: path.join(tmp, "hooks.log")
        }
    };
}

/**
 * Read the outbox's result.json.
 * @param {string} outbox - The outbox directory.
 * @returns {any} - The parsed result.
 */
const result = outbox => JSON.parse(fs.readFileSync(path.join(outbox, "result.json"), "utf8"));

after(() => {
    for (const dir of dirs) {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

describe("the in-container stage runner", () => {
    test("a normal session: result.json carries the harness outcome", () => {
        const w = world();
        const env = {...w.env, FAKE_TOUCH: "touched.txt"};
        execFileSync("bash", [path.join(root, "pipeline/stage.sh"), "25", "build"], {
            cwd: root,
            env,
            stdio: "pipe"
        });
        const r = result(w.outbox);
        assert.equal(r.exit, 0);
        assert.equal(r.session, "fake-session-1");
        assert.equal(r.usage.status, "ok");
        assert.equal(r.usage.costUsd, 0.25);
        assert.ok(r.changed.includes("touched.txt"));
        assert.deepEqual(r.commits, []);
        assert.equal(r.resumes, 0);
        assert.match(fs.readFileSync(path.join(w.outbox, "log"), "utf8"), /fake harness ran/);
        const origin = execFileSync("git", ["-C", w.env.WORK, "remote", "get-url", "origin"], {
            encoding: "utf8"
        }).trim();
        assert.equal(origin, "https://github.com/tjlytle/Sozi.git");
    });
    test("the log carries the step markers", () => {
        const w = world();
        execFileSync("bash", [path.join(root, "pipeline/stage.sh"), "25", "build"], {
            cwd: root,
            env: w.env,
            stdio: "pipe"
        });
        assert.match(fs.readFileSync(path.join(w.outbox, "log"), "utf8"), /^== harness$/m);
    });
    test("a failing harness is not resumed", () => {
        const w = world();
        execFileSync("bash", [path.join(root, "pipeline/stage.sh"), "25", "build"], {
            cwd: root,
            env: {...w.env, FAKE_EXIT: "3"},
            stdio: "pipe"
        });
        const r = result(w.outbox);
        assert.equal(r.exit, 3);
        assert.equal(r.resumes, 0);
        assert.equal(fs.existsSync(w.env.HOOKS_LOG), false);
    });
    test("an early failure still writes result.json", () => {
        const w = world();
        spawnSync("bash", [path.join(root, "pipeline/stage.sh"), "25", "build"], {
            cwd: root,
            env: {...w.env, MIRROR: path.join(w.tmp, "missing.git")},
            stdio: "pipe"
        });
        const r = result(w.outbox);
        assert.equal(r.exit, 1);
        assert.equal(r.session, null);
        assert.equal(r.usage.status, "error");
        assert.deepEqual(r.changed, []);
    });
    test("findings resume the session once, then it settles", () => {
        const w = world();
        fs.writeFileSync(w.env.HOOKS_OUTSIDE, RESUMING_HOOKS, {mode: 0o755});
        execFileSync("bash", [path.join(root, "pipeline/stage.sh"), "25", "build"], {
            cwd: root,
            env: w.env,
            stdio: "pipe"
        });
        const r = result(w.outbox);
        assert.equal(r.resumes, 1);
        assert.equal(fs.readFileSync(path.join(w.outbox, "report-0.txt"), "utf8"), "fix it\n");
        assert.match(fs.readFileSync(path.join(w.outbox, "log"), "utf8"), /== resume/);
    });
});
