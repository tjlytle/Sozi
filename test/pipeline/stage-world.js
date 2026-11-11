// test/pipeline/stage-world.js: the scratch world the stage runner's tests run
// pipeline/stage.sh in: a bare mirror, a node_modules cache, a fake harness and fake hooks.
import {execFileSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8"
}).trim();
/** @type {string[]} */
export const dirs = [];

const FAKE_HARNESS = `#!/usr/bin/env bash
mode="$1"; all="$*"; out=""; checkout=""
while [ $# -gt 0 ]; do
    case "$1" in
        --out) out="$2"; shift ;;
        --checkout) checkout="$2"; shift ;;
    esac
    shift
done
echo "fake harness ran"
echo "$all" >>"$out/calls"
if [ "$mode" = resume ] && [ -n "\${FAKE_RESUME_EXIT:-}" ]; then
    echo '{"tokensIn": 0, "tokensOut": 0, "costUsd": 0, "turns": 0, "status": "error"}' >"$out/usage.json"
    exit "$FAKE_RESUME_EXIT"
fi
echo "display=\${DISPLAY:-}" >>"$out/display"
env | grep '^GH_AS_' | sort >"$out/gh-as-env"
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

const FAKE_HOOKS = `#!/usr/bin/env bash
echo "called" >>"$HOOKS_LOG"
: >"$3"
exit 0
`;

/**
 * Make a bare mirror of a repository: the mirror has master and only the branches the test asks for.
 * @param {string} source - The repository to mirror.
 * @param {string} tmp - The directory the mirror goes in.
 * @param {boolean} issueBranch - Whether the mirror also has a 25-slug branch.
 * @returns {{mirror: string, sha: string}} - The mirror's path and the commit its branches point at.
 */
export function mirrorOf(source, tmp, issueBranch) {
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
export function world(issueBranch = false) {
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
export const result = outbox =>
    JSON.parse(fs.readFileSync(path.join(outbox, "result.json"), "utf8"));

export const stage = path.join(root, "pipeline/stage.sh");
/**
 * Run the stage runner to completion.
 * @param {Record<string, string>} env - The environment.
 * @returns {Buffer} - Standard output.
 */
export const runStage = env =>
    execFileSync("bash", [stage, "25", "build"], {cwd: root, env, stdio: "pipe"});

/** Remove every scratch directory the world made; each test file calls it from after(). */
export function cleanUp() {
    for (const dir of dirs) {
        fs.rmSync(dir, {recursive: true, force: true});
    }
}
