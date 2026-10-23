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
echo "display=\${DISPLAY:-}" >>"$out/display"
[ -z "\${FAKE_NO_SESSION:-}" ] && echo "fake-session-1" >"$out/session"
echo '{"tokensIn": 10, "tokensOut": 5, "costUsd": 0.25, "turns": 2, "status": "ok"}' >"$out/usage.json"
[ -n "\${FAKE_SLEEP:-}" ] && sleep "$FAKE_SLEEP"
if [ -n "\${FAKE_MERGE:-}" ]; then
    g() { git -C "$checkout" -c user.name=t -c user.email=t@t "$@"; }
    echo "mine" >"$checkout/own.txt"
    g add own.txt && g commit -q -m own && g merge -q --no-ff -m merge "origin/$FAKE_MERGE"
fi
[ -n "\${FAKE_TOUCH:-}" ] && echo "changed" >"$checkout/$FAKE_TOUCH"
[ -n "\${FAKE_SCRIPT:-}" ] && (cd "$checkout" && bash -ec "$FAKE_SCRIPT")
exit "\${FAKE_EXIT:-0}"
`;

/** A stand-in for Xvfb: logs its arguments, creates the display socket, logs when stopped. */
const FAKE_XVFB = `#!/usr/bin/env bash
echo "args $*" >>"$XVFB_LOG"
touch "$X11_DIR/X$DISPLAY_NUM"
trap 'echo stopped >>"$XVFB_LOG"; exit 0' TERM
while true; do sleep 0.1; done
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

const RECORDING_HOOKS = `#!/usr/bin/env bash
"$CHANGED_FILES" "$1" "$2" >>"$HOOKS_LOG"
: >"$3"
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
 * Make a bare mirror of a repository: the mirror has master and only the branches the test asks for.
 * @param {string} source - The repository to mirror.
 * @param {string} tmp - The directory the mirror goes in.
 * @param {boolean} issueBranch - Whether the mirror also has a 25-slug branch.
 * @returns {{mirror: string, sha: string}} - The mirror's path and the commit its branches point at.
 */
function mirrorOf(source, tmp, issueBranch) {
    const mirror = path.join(tmp, "mirror.git");
    execFileSync("git", ["clone", "-q", "--bare", "--shared", source, mirror]);
    const sha = execFileSync(
        "sh",
        ["-c", "git rev-parse --verify master 2>/dev/null || git rev-parse HEAD"],
        {cwd: source, encoding: "utf8"}
    ).trim();
    const git = (/** @type {string[]} */ ...args) =>
        execFileSync("git", ["-C", mirror, ...args], {encoding: "utf8"});
    for (const ref of git("for-each-ref", "--format=%(refname)", "refs/heads/").split("\n")) {
        if (ref) {
            git("update-ref", "-d", ref);
        }
    }
    git("branch", "master", sha);
    git("symbolic-ref", "HEAD", "refs/heads/master");
    if (issueBranch) {
        git("branch", "25-slug", sha);
    }
    return {mirror, sha};
}

/**
 * Seed a node_modules cache whose lock-sha matches the lockfile at a commit.
 * @param {string} tmp - The directory the cache goes in.
 * @param {string} sha - The commit whose package-lock.json the cache matches.
 * @returns {string} - The cache's path.
 */
function seedCache(tmp, sha) {
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
    return cache;
}

/**
 * Build a scratch world for one stage run: mirror, outbox, cache and fake scripts.
 * @param {boolean} [issueBranch] - Whether the mirror has a 25-slug branch.
 * @returns {{tmp: string, outbox: string, env: Record<string, string>}} - The paths and the environment.
 */
function world(issueBranch = false) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stage-run-"));
    dirs.push(tmp);
    const {mirror, sha} = mirrorOf(root, tmp, issueBranch);
    const harnessDir = path.join(tmp, "harness");
    fs.mkdirSync(harnessDir);
    fs.writeFileSync(path.join(harnessDir, "fake"), FAKE_HARNESS, {mode: 0o755});
    const hooks = path.join(tmp, "hooks.sh");
    fs.writeFileSync(hooks, FAKE_HOOKS, {mode: 0o755});
    const outbox = path.join(tmp, "outbox");
    fs.mkdirSync(outbox);
    fs.writeFileSync(path.join(outbox, "prompt.md"), "do the thing\n");
    fs.writeFileSync(path.join(outbox, "allow.txt"), "Read\n");
    const cache = seedCache(tmp, sha);
    return {
        tmp,
        outbox,
        env: {
            ...process.env,
            PIPELINE_REPO: "tjlytle/Sozi",
            PIPELINE_HARNESS: "fake",
            PIPELINE_MODEL: "m",
            PIPELINE_OFFLINE: "1",
            MIRROR: mirror,
            OUTBOX: outbox,
            WORK: path.join(tmp, "work"),
            CACHE: cache,
            HARNESS_DIR: harnessDir,
            HOOKS_OUTSIDE: hooks,
            CHANGED_FILES: path.join(root, "pipeline/changed-files.sh"),
            HOOKS_LOG: path.join(tmp, "hooks.log"),
            XVFB_BIN: "no-such-xvfb"
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
    /**
     * List the branches of a mirror built from a source that has a 25-aaa branch.
     * @param {boolean} issueBranch - Whether the mirror is asked for 25-slug.
     * @returns {string[]} - The mirror's branch refs.
     */
    const mirrorBranches = issueBranch => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stage-mirror-"));
        dirs.push(tmp);
        const source = path.join(tmp, "source");
        execFileSync("git", ["clone", "-q", "--shared", root, source]);
        execFileSync("git", ["-C", source, "branch", "25-aaa"]);
        const {mirror} = mirrorOf(source, tmp, issueBranch);
        const refs = ["-C", mirror, "for-each-ref", "--format=%(refname)", "refs/heads/"];
        return execFileSync("git", refs, {encoding: "utf8"}).trim().split("\n");
    };
    test("the mirror holds only master whatever branches the source has", () => {
        assert.deepEqual(mirrorBranches(false), ["refs/heads/master"]);
    });
    test("the mirror holds master and 25-slug when the test asks for the issue branch", () => {
        assert.deepEqual(mirrorBranches(true), ["refs/heads/25-slug", "refs/heads/master"]);
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
    test("PIPELINE_MAX_RESUMES=0 runs the outside checks once and never resumes", () => {
        const w = world();
        fs.writeFileSync(w.env.HOOKS_OUTSIDE, NEW_HOOKS, {mode: 0o755});
        runStage({...w.env, PIPELINE_MAX_RESUMES: "0"});
        const r = result(w.outbox);
        assert.equal(r.hooks, "ok");
        assert.equal(r.resumes, 0);
        assert.ok(fs.existsSync(path.join(w.outbox, "report-0.txt")));
        assert.ok(!fs.existsSync(path.join(w.outbox, "report-1.txt")));
    });
    test("the last resume's work is checked", () => {
        const w = world();
        fs.writeFileSync(w.env.HOOKS_OUTSIDE, NEW_HOOKS, {mode: 0o755});
        runStage({...w.env, PIPELINE_MAX_RESUMES: "1"});
        assert.equal(result(w.outbox).resumes, 1);
        assert.ok(fs.existsSync(path.join(w.outbox, "report-1.txt")));
    });
    test("one display for the session when none is set, stopped at the end (#73)", async () => {
        const w = world();
        const bin = path.join(w.tmp, "bin");
        const x11 = path.join(w.tmp, "x11");
        fs.mkdirSync(bin);
        fs.mkdirSync(x11);
        fs.writeFileSync(path.join(bin, "Xvfb"), FAKE_XVFB, {mode: 0o755});
        const log = path.join(w.tmp, "xvfb.log");
        const env = {
            ...Object.fromEntries(Object.entries(w.env).filter(([key]) => key !== "DISPLAY")),
            PATH: `${bin}:${process.env.PATH}`,
            XVFB_BIN: "Xvfb",
            XVFB_LOG: log,
            X11_DIR: x11,
            DISPLAY_NUM: "97"
        };
        runStage(env);
        assert.equal(fs.readFileSync(path.join(w.outbox, "display"), "utf8").trim(), "display=:97");
        assert.match(
            fs.readFileSync(log, "utf8"),
            /^args :97 -screen 0 1920x1080x24 -nolisten tcp/
        );
        for (let i = 0; i < 40 && !fs.readFileSync(log, "utf8").includes("stopped"); i++) {
            await new Promise(r => setTimeout(r, 50));
        }
        assert.match(fs.readFileSync(log, "utf8"), /stopped/);
    });
    test("a display that is already set is kept and no Xvfb starts (#73)", () => {
        const w = world();
        const bin = path.join(w.tmp, "bin");
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, "Xvfb"), FAKE_XVFB, {mode: 0o755});
        const log = path.join(w.tmp, "xvfb.log");
        runStage({
            ...w.env,
            PATH: `${bin}:${process.env.PATH}`,
            XVFB_BIN: "Xvfb",
            XVFB_LOG: log,
            DISPLAY: ":5"
        });
        assert.equal(fs.readFileSync(path.join(w.outbox, "display"), "utf8").trim(), "display=:5");
        assert.ok(!fs.existsSync(log), "Xvfb did not start");
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
    test("a merge of master adds nothing to changed or to what the hooks see (#89)", () => {
        const w = world();
        const side = path.join(w.tmp, "side");
        execFileSync("git", ["clone", "-q", w.env.MIRROR, side]);
        const git = (/** @type {string[]} */ ...args) =>
            execFileSync("git", ["-C", side, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
        fs.writeFileSync(path.join(side, "merged.txt"), "from master\n");
        git("add", "merged.txt");
        git("commit", "-q", "-m", "side");
        git("push", "-q", "origin", "HEAD:refs/heads/side");
        fs.writeFileSync(w.env.HOOKS_OUTSIDE, RECORDING_HOOKS, {mode: 0o755});
        runStage({...w.env, FAKE_MERGE: "side", FAKE_TOUCH: "touched.txt"});
        assert.deepEqual(result(w.outbox).changed, ["own.txt", "touched.txt"]);
        assert.equal(fs.readFileSync(w.env.HOOKS_LOG, "utf8"), "own.txt\ntouched.txt\n");
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
    /**
     * Give a world's mirror a side branch carrying one unrelated commit that adds other.txt.
     * @param {{tmp: string, env: Record<string, string>}} w - The world.
     */
    const addSideBranch = w => {
        const side = path.join(w.tmp, "side");
        execFileSync("git", ["clone", "-q", "--shared", w.env.MIRROR, side]);
        fs.writeFileSync(path.join(side, "other.txt"), "other\n");
        const git = (/** @type {string[]} */ ...args) =>
            execFileSync("git", ["-C", side, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
        git("add", "other.txt");
        git("commit", "-q", "-m", "Add other.txt");
        git("push", "-q", "origin", "HEAD:refs/heads/side");
    };
    /** Shell that commits a file in the session, with a fixed author: `own <file> <subject>`. */
    const OWN = `own() { echo "$1" >"$1"; git add "$1"; git -c user.name=t -c user.email=t@t commit -q -m "$2"; }
merge_side() { git fetch -q "$MIRROR" side; git -c user.name=t -c user.email=t@t merge -q --no-ff -m "Merge side" FETCH_HEAD; }
`;
    test("a session that merges master lists only its own commit (#105)", () => {
        const w = world();
        addSideBranch(w);
        runStage({...w.env, FAKE_SCRIPT: `${OWN}own own.txt "Add own.txt"\nmerge_side\n`});
        const r = result(w.outbox);
        assert.equal(r.commits.length, 1, JSON.stringify(r.commits));
        assert.match(r.commits[0], / Add own\.txt$/);
    });
    test("own commits on both sides of a merge are all listed (#105)", () => {
        const w = world();
        addSideBranch(w);
        const script = `${OWN}own a.txt "Add a.txt"\nmerge_side\nown b.txt "Add b.txt"\n`;
        runStage({...w.env, FAKE_SCRIPT: script});
        const subjects = result(w.outbox).commits.map((/** @type {string} */ c) =>
            c.replace(/^\S+ /, "")
        );
        assert.deepEqual(subjects, ["Add b.txt", "Add a.txt"]);
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
