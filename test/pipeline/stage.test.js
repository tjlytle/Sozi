import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawn, spawnSync} from "node:child_process";
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
[ -z "\${FAKE_NO_SESSION:-}" ] && echo "fake-session-1" >"$out/session"
echo '{"tokensIn": 10, "tokensOut": 5, "costUsd": 0.25, "turns": 2, "status": "ok"}' >"$out/usage.json"
[ -n "\${FAKE_SLEEP:-}" ] && sleep "$FAKE_SLEEP"
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

const SAME_HOOKS = `#!/usr/bin/env bash
echo "called" >>"$HOOKS_LOG"
echo "same finding" >"$3"
exit 1
`;

const NEW_HOOKS = `#!/usr/bin/env bash
echo "called" >>"$HOOKS_LOG"
echo "finding $(wc -l <"$HOOKS_LOG")" >"$3"
exit 1
`;

const CRASHED_HOOKS = `#!/usr/bin/env bash
echo "called" >>"$HOOKS_LOG"
exit 2
`;

const FAKE_NPM = `#!/usr/bin/env bash
echo "$@" >>"$NPM_LOG"
mkdir -p node_modules
`;

/**
 * Build a scratch world for one stage run: mirror, outbox, cache and fake scripts.
 * @param {boolean} [issueBranch] - Whether the mirror has a 25-slug branch.
 * @returns {{tmp: string, outbox: string, env: Record<string, string>}} - The paths and the environment.
 */
function world(issueBranch = false) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stage-run-"));
    dirs.push(tmp);
    const mirror = path.join(tmp, "mirror.git");
    execFileSync("git", ["clone", "-q", "--bare", "--shared", root, mirror]);
    const sha = execFileSync(
        "sh",
        ["-c", "git rev-parse --verify master 2>/dev/null || git rev-parse HEAD"],
        {cwd: root, encoding: "utf8"}
    ).trim();
    execFileSync("git", ["-C", mirror, "branch", "-f", "master", sha]);
    if (issueBranch) {
        execFileSync("git", ["-C", mirror, "branch", "-f", "25-slug", sha]);
    }
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
    const lock = execFileSync("git", ["show", `${sha}:package-lock.json`], {
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
        assert.equal(r.hooks, "skipped", "the outside checks never ran");
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
        assert.equal(r.hooks, "skipped");
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
    const stage = path.join(root, "pipeline/stage.sh");
    /**
     * Run the stage runner to completion.
     * @param {Record<string, string>} env - The environment.
     * @returns {Buffer} - Standard output.
     */
    const runStage = env =>
        execFileSync("bash", [stage, "25", "build"], {cwd: root, env, stdio: "pipe"});
    /**
     * Name the branch the work checkout ended up on.
     * @param {Record<string, string>} env - The environment.
     * @returns {string} - The branch name.
     */
    const branchOf = env =>
        execFileSync("git", ["-C", env.WORK, "rev-parse", "--abbrev-ref", "HEAD"], {
            encoding: "utf8"
        }).trim();

    test("the issue's branch is checked out when the mirror has one", () => {
        const w = world(true);
        runStage(w.env);
        assert.equal(branchOf(w.env), "25-slug");
    });
    test("master is checked out when there is no issue branch", () => {
        const w = world();
        runStage(w.env);
        assert.equal(branchOf(w.env), "master");
    });
    test("the same report twice resumes exactly once", () => {
        const w = world();
        fs.writeFileSync(w.env.HOOKS_OUTSIDE, SAME_HOOKS, {mode: 0o755});
        runStage(w.env);
        assert.equal(result(w.outbox).resumes, 1);
    });
    test("PIPELINE_MAX_RESUMES caps the resumes", () => {
        const w = world();
        fs.writeFileSync(w.env.HOOKS_OUTSIDE, NEW_HOOKS, {mode: 0o755});
        runStage({...w.env, PIPELINE_MAX_RESUMES: "2"});
        assert.equal(result(w.outbox).resumes, 2);
    });
    test("a lockfile mismatch installs with npm ci", () => {
        const w = world();
        fs.writeFileSync(path.join(w.tmp, "cache/lock-sha"), "bogus\n");
        const bin = path.join(w.tmp, "bin");
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, "npm"), FAKE_NPM, {mode: 0o755});
        const npmLog = path.join(w.tmp, "npm.log");
        runStage({...w.env, PATH: `${bin}:${process.env.PATH}`, NPM_LOG: npmLog});
        assert.match(fs.readFileSync(npmLog, "utf8"), /^ci /);
    });
    test("a session that changes nothing: real hooks pass, no resume", () => {
        const w = world();
        runStage({...w.env, HOOKS_OUTSIDE: path.join(root, "pipeline/hooks-outside.sh")});
        const r = result(w.outbox);
        assert.equal(r.resumes, 0);
        assert.equal(fs.readFileSync(path.join(w.outbox, "report-0.txt"), "utf8"), "");
    });
    test("a crashed hooks pass is an error, not a clean run", () => {
        const w = world();
        fs.writeFileSync(w.env.HOOKS_OUTSIDE, CRASHED_HOOKS, {mode: 0o755});
        runStage(w.env);
        const r = result(w.outbox);
        assert.equal(r.hooks, "error");
        assert.equal(r.resumes, 0);
        assert.match(
            fs.readFileSync(path.join(w.outbox, "log"), "utf8"),
            /== hooks-outside failed \(exit 2\)/
        );
    });
    test("a clean run records hooks ok", () => {
        const w = world();
        runStage(w.env);
        assert.equal(result(w.outbox).hooks, "ok");
    });
    test("an exit 0 without a session file is not resumed", () => {
        const w = world();
        fs.writeFileSync(w.env.HOOKS_OUTSIDE, NEW_HOOKS, {mode: 0o755});
        runStage({...w.env, FAKE_NO_SESSION: "1"});
        const r = result(w.outbox);
        assert.equal(r.resumes, 0);
        assert.equal(r.session, null);
        assert.equal(r.hooks, "skipped");
        assert.match(fs.readFileSync(path.join(w.outbox, "log"), "utf8"), /== no session file/);
    });
    test("a harness name with a slash is rejected", () => {
        const w = world();
        runStage({...w.env, PIPELINE_HARNESS: "../fake"});
        const r = result(w.outbox);
        assert.equal(r.exit, 1);
        assert.equal(r.usage.status, "error");
    });
    test("SIGTERM still leaves a result.json", async () => {
        const w = world();
        const child = spawn("bash", [stage, "25", "build"], {
            cwd: root,
            env: {...w.env, FAKE_SLEEP: "5"},
            stdio: "pipe"
        });
        const log = path.join(w.outbox, "log");
        for (let i = 0; i < 100; i++) {
            if (fs.existsSync(log) && fs.readFileSync(log, "utf8").includes("fake harness ran")) {
                break;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        child.kill("SIGTERM");
        await new Promise(r => child.on("exit", r));
        assert.equal(result(w.outbox).exit, 143);
    });
});
