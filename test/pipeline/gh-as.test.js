import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
const ghAs = path.join(root, "packages/gh-as/bin/gh-as");
const realGit = execFileSync("sh", ["-c", "command -v git"], {encoding: "utf8"}).trim();
const SIGNATURE = "architect · codex · gpt-5.5";
/** @type {string[]} */
const dirs = [];

/** Records its argv (NUL-separated) and the body it was given, from a flag, a file or stdin. */
const FAKE_GH = `#!/usr/bin/env bash
printf '%s\\0' "$@" >"$FAKE_DIR/gh-argv"
prev=""
for a in "$@"; do
    case "$prev" in
        -b|--body) printf '%s' "$a" >"$FAKE_DIR/gh-body" ;;
        -F|--body-file) if [ "$a" = - ]; then cat >"$FAKE_DIR/gh-body"; else cat "$a" >"$FAKE_DIR/gh-body"; fi ;;
    esac
    prev="$a"
done
exit "\${FAKE_GH_EXIT:-0}"
`;

/** Records the argv of a commit; every other git command is the real git. */
const FAKE_GIT = `#!/usr/bin/env bash
for a in "$@"; do
    if [ "$a" = commit ]; then printf '%s\\0' "$@" >"$FAKE_DIR/git-argv"; exit 0; fi
done
exec "$REAL_GIT" "$@"
`;

/** The mint: any request gets a token. */
const FAKE_CURL = `#!/usr/bin/env bash
echo '{"token": "ghs_fake"}'
`;

after(() => {
    for (const dir of dirs) {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

/**
 * A scratch repository whose personas are bound to Apps, fakes for gh, git and the mint, and
 * an empty TMPDIR at `<dir>/tmp`.
 *
 * @returns {{dir: string, repo: string, env: Record<string, string>}} - The scratch dir, the repository and the environment.
 */
function world() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-as-"));
    dirs.push(dir);
    const bin = path.join(dir, "bin");
    const repo = path.join(dir, "repo");
    const tmp = path.join(dir, "tmp");
    fs.mkdirSync(bin);
    fs.mkdirSync(repo);
    fs.mkdirSync(tmp);
    fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, {mode: 0o755});
    fs.writeFileSync(path.join(bin, "git"), FAKE_GIT, {mode: 0o755});
    fs.writeFileSync(path.join(bin, "curl"), FAKE_CURL, {mode: 0o755});
    execFileSync(realGit, ["init", "-q", repo]);
    execFileSync(realGit, [
        "-C",
        repo,
        "remote",
        "add",
        "origin",
        "https://github.com/tjlytle/Sozi.git"
    ]);
    fs.writeFileSync(
        path.join(repo, "CLAUDE.md"),
        "# Test\n\n## GitHub Workflow\n\nBots: architect=architect\n"
    );
    /** @type {Record<string, string>} */
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && !key.startsWith("GH_AS_") && key !== "GH_TOKEN") {
            env[key] = value;
        }
    }
    Object.assign(env, {
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_DIR: dir,
        REAL_GIT: realGit,
        TMPDIR: tmp,
        GH_MINT_URL: "http://mint.invalid/",
        GH_MINT_KEY: "k",
        GH_BOT_CONFIG_DIR: path.join(dir, "gh-bot")
    });
    return {dir, repo, env};
}

/**
 * Run gh-as as architect in the world's repository and assert that it succeeded.
 *
 * @param {{repo: string, env: Record<string, string>}} w - The world.
 * @param {string[]} args - The arguments after the persona.
 * @param {{env?: Record<string, string>, input?: string}} [opts] - Extra environment and stdin.
 * @returns {void}
 */
function ghAsRun(w, args, opts = {}) {
    const r = ghAsStatus(w, args, opts);
    assert.equal(r.status, 0, r.stderr);
}

/**
 * Run gh-as as architect in the world's repository and return how it exited.
 *
 * @param {{repo: string, env: Record<string, string>}} w - The world.
 * @param {string[]} args - The arguments after the persona.
 * @param {{env?: Record<string, string>, input?: string}} [opts] - Extra environment and stdin.
 * @returns {{status: number | null, stderr: string}} - The exit status and stderr.
 */
function ghAsStatus(w, args, opts = {}) {
    return spawnSync("bash", [ghAs, "architect", ...args], {
        cwd: w.repo,
        env: {...w.env, ...opts.env},
        input: opts.input ?? "",
        encoding: "utf8"
    });
}

/**
 * List what gh-as left in the world's TMPDIR.
 *
 * @param {{dir: string}} w - The world.
 * @returns {string[]} - The entry names.
 */
const leftovers = w => fs.readdirSync(path.join(w.dir, "tmp"));

/**
 * Read a NUL-separated argv the fakes recorded.
 *
 * @param {string} file - The file.
 * @returns {string[]} - The arguments.
 */
const argv = file => fs.readFileSync(file, "utf8").split("\0").slice(0, -1);

/**
 * Read the body the fake gh was given.
 *
 * @param {{dir: string}} w - The world.
 * @returns {string} - The body.
 */
const body = w => fs.readFileSync(path.join(w.dir, "gh-body"), "utf8");

/**
 * Count the lines of a body that are the signature.
 *
 * @param {string} text - The body.
 * @returns {number} - How many lines are the signature.
 */
const signatures = text => text.split("\n").filter(line => line === SIGNATURE).length;

const SIGNED = {GH_AS_SIGNATURE: SIGNATURE, GH_AS_HARNESS: "codex", GH_AS_MODEL: "gpt-5.5"};

describe("gh-as", () => {
    test("issue comment --body-file: the body ends with the signature, once", () => {
        const w = world();
        const file = path.join(w.dir, "comment.md");
        fs.writeFileSync(file, "Looks good.\n");
        ghAsRun(w, ["issue", "comment", "7", "--body-file", file], {env: SIGNED});
        assert.match(body(w), /^Looks good\.\n\narchitect · codex · gpt-5\.5\n?$/);
        assert.equal(fs.readFileSync(file, "utf8"), "Looks good.\n", "the caller's file is kept");
    });
    test("issue comment --body: the body ends with the signature, once", () => {
        const w = world();
        ghAsRun(w, ["issue", "comment", "7", "--body", "Done."], {env: SIGNED});
        assert.match(body(w), /^Done\.\n\narchitect · codex · gpt-5\.5\n?$/);
    });
    test("issue comment -F - reads stdin and signs it", () => {
        const w = world();
        ghAsRun(w, ["issue", "comment", "7", "-F", "-"], {env: SIGNED, input: "From stdin.\n"});
        assert.match(body(w), /^From stdin\.\n\narchitect · codex · gpt-5\.5\n?$/);
    });
    test("pr create --body-file and pr review --body are signed", () => {
        const w = world();
        const file = path.join(w.dir, "pr.md");
        fs.writeFileSync(file, "Closes #1\n\n## What changed\n");
        ghAsRun(w, ["pr", "create", "--title", "t", "--body-file", file], {env: SIGNED});
        assert.equal(signatures(body(w)), 1);
        assert.ok(body(w).trimEnd().endsWith(`\n\n${SIGNATURE}`));
        ghAsRun(w, ["pr", "review", "3", "--approve", "-b", "Fine."], {env: SIGNED});
        assert.match(body(w), /^Fine\.\n\narchitect · codex · gpt-5\.5\n?$/);
    });
    test("issue edit and pr edit bodies are signed", () => {
        const w = world();
        ghAsRun(w, ["issue", "edit", "7", "--body", "New body."], {env: SIGNED});
        assert.equal(signatures(body(w)), 1);
        ghAsRun(w, ["pr", "edit", "3", "--body", "New body."], {env: SIGNED});
        assert.equal(signatures(body(w)), 1);
    });
    test("a body that already ends with the signature is posted unchanged", () => {
        const w = world();
        const file = path.join(w.dir, "signed.md");
        const signed = `Looks good.\n\n${SIGNATURE}\n\n`;
        fs.writeFileSync(file, signed);
        ghAsRun(w, ["issue", "comment", "7", "--body-file", file], {env: SIGNED});
        assert.equal(body(w), signed);
        ghAsRun(w, ["issue", "comment", "7", "--body", `Done.\n\n${SIGNATURE}`], {env: SIGNED});
        assert.equal(body(w), `Done.\n\n${SIGNATURE}`);
    });
    test("a call with no body flag is left alone", () => {
        const w = world();
        ghAsRun(w, ["issue", "view", "7", "--comments"], {env: SIGNED});
        assert.deepEqual(argv(path.join(w.dir, "gh-argv")), ["issue", "view", "7", "--comments"]);
    });
    test("git commit gets the Harness and Model trailers", () => {
        const w = world();
        ghAsRun(w, ["--git", "commit", "-m", "x"], {env: SIGNED});
        const a = argv(path.join(w.dir, "git-argv"));
        const at = a.indexOf("commit");
        assert.deepEqual(a.slice(at), [
            "commit",
            "--trailer",
            "Harness: codex",
            "--trailer",
            "Model: gpt-5.5",
            "-m",
            "x"
        ]);
    });
    test("git commit without GH_AS_MODEL gets only the Harness trailer", () => {
        const w = world();
        const {GH_AS_MODEL, ...noModel} = SIGNED;
        assert.ok(GH_AS_MODEL);
        ghAsRun(w, ["--git", "commit", "-m", "x"], {env: noModel});
        const a = argv(path.join(w.dir, "git-argv"));
        assert.deepEqual(a.slice(a.indexOf("commit")), [
            "commit",
            "--trailer",
            "Harness: codex",
            "-m",
            "x"
        ]);
    });
    test("without GH_AS_SIGNATURE, argv and body reach gh and git byte for byte", () => {
        const w = world();
        const file = path.join(w.dir, "comment.md");
        fs.writeFileSync(file, "Looks good.\n");
        const noSignature = {GH_AS_HARNESS: "codex", GH_AS_MODEL: "gpt-5.5"};
        ghAsRun(w, ["issue", "comment", "7", "--body-file", file], {env: noSignature});
        assert.deepEqual(argv(path.join(w.dir, "gh-argv")), [
            "issue",
            "comment",
            "7",
            "--body-file",
            file
        ]);
        assert.equal(body(w), "Looks good.\n");
        ghAsRun(w, ["--git", "commit", "-m", "x"], {env: noSignature});
        const a = argv(path.join(w.dir, "git-argv"));
        assert.deepEqual(a.slice(a.indexOf("commit")), ["commit", "-m", "x"]);
        assert.deepEqual(leftovers(w), [], "nothing is created in TMPDIR");
    });
    test("a signed --body-file leaves no copy in TMPDIR and keeps the caller's file", () => {
        const w = world();
        const file = path.join(w.dir, "comment.md");
        fs.writeFileSync(file, "Looks good.\n");
        ghAsRun(w, ["issue", "comment", "7", "--body-file", file], {env: SIGNED});
        assert.match(body(w), /^Looks good\.\n\narchitect · codex · gpt-5\.5\n?$/);
        assert.deepEqual(leftovers(w), []);
        assert.equal(fs.readFileSync(file, "utf8"), "Looks good.\n");
    });
    test("a signed body from stdin leaves no copy in TMPDIR", () => {
        const w = world();
        ghAsRun(w, ["issue", "comment", "7", "-F", "-"], {env: SIGNED, input: "From stdin.\n"});
        assert.equal(signatures(body(w)), 1);
        assert.deepEqual(leftovers(w), []);
    });
    test("when gh fails, gh-as exits with its status and still removes the copy", () => {
        const w = world();
        const file = path.join(w.dir, "comment.md");
        fs.writeFileSync(file, "Looks good.\n");
        const r = ghAsStatus(w, ["issue", "comment", "7", "--body-file", file], {
            env: {...SIGNED, FAKE_GH_EXIT: "3"}
        });
        assert.equal(r.status, 3, r.stderr);
        assert.match(body(w), /^Looks good\.\n\narchitect · codex · gpt-5\.5\n?$/);
        assert.deepEqual(leftovers(w), []);
    });
    test("an already signed --body-file reaches gh by its own path and is kept", () => {
        const w = world();
        const file = path.join(w.dir, "signed.md");
        const signed = `Looks good.\n\n${SIGNATURE}\n`;
        fs.writeFileSync(file, signed);
        ghAsRun(w, ["issue", "comment", "7", "--body-file", file], {env: SIGNED});
        const a = argv(path.join(w.dir, "gh-argv"));
        assert.equal(a[a.indexOf("--body-file") + 1], file);
        assert.equal(fs.readFileSync(file, "utf8"), signed);
        assert.deepEqual(leftovers(w), []);
    });
    test("a signed --body leaves nothing in TMPDIR", () => {
        const w = world();
        ghAsRun(w, ["issue", "comment", "7", "--body", "Done."], {env: SIGNED});
        assert.deepEqual(leftovers(w), []);
    });
});
