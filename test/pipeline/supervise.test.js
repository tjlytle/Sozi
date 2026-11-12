// test/pipeline/supervise.test.js: bin/supervise.js, the launch of the supervisor session
// and --apply, over a fake runner.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {emptyState, applyIssue} from "../../pipeline/lib/state.js";
import {main} from "../../bin/supervise.js";
import {issue} from "./pass-world.js";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const PATCH = "diff --git a/.claude/x b/.claude/x\n--- a/.claude/x\n+++ b/.claude/x\n";

/**
 * Fakes for everything outside bin/supervise.js, recording each call.
 *
 * @param {{fail?: string}} [options] - The command (its second word) that exits 1.
 * @returns {any} - The calls, the output and the deps.
 */
function fakes({fail} = {}) {
    /** @type {any[]} */
    const calls = [];
    const h = {calls, out: "", err: ""};
    return {
        ...h,
        out: (/** @type {string} */ t) => void (h.out += t),
        err: (/** @type {string} */ t) => void (h.err += t),
        text: h,
        deps: {
            spawn: async (/** @type {string} */ cmd, /** @type {string[]} */ args, opts) => {
                calls.push({cmd, args, opts});
                return 0;
            },
            run: async (/** @type {string} */ cmd, /** @type {string[]} */ args, opts) => {
                calls.push({cmd, args, cwd: opts?.cwd});
                if (args.includes("ls-remote")) {
                    return {code: 0, stdout: "abc\trefs/heads/516-supervisor\n", stderr: ""};
                }
                return {code: args[1] === fail ? 1 : 0, stdout: "", stderr: "boom"};
            },
            tmpdir: () => "/tmp/wt-516"
        }
    };
}

/**
 * A root with a kept patch for #516 and a supervisor state where #516 waits.
 *
 * @param {string} patch - The kept patch.
 * @returns {string} - The root.
 */
function rootWithPatch(patch) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sv-"));
    fs.mkdirSync(path.join(root, "var", "pipeline", "protected"), {recursive: true});
    fs.writeFileSync(path.join(root, "var", "pipeline", "protected", "516.patch"), patch);
    const state = emptyState();
    applyIssue(state, issue(516, ["stage:in-progress", "supervised"]));
    state.issues[516].waiting = true;
    fs.writeFileSync(path.join(root, "var", "pipeline", "supervisor.json"), JSON.stringify(state));
    return root;
}

/**
 * Read #516's waiting flag from the supervisor state.
 *
 * @param {string} root - The root.
 * @returns {boolean} - The flag.
 */
const waiting = root =>
    JSON.parse(fs.readFileSync(path.join(root, "var", "pipeline", "supervisor.json"), "utf8"))
        .issues[516].waiting;

describe("launching the supervisor", () => {
    test("starts claude on the supervisor model with the prompt and its own state", async () => {
        const f = fakes();
        const code = await main(["213", "295"], {root: REPO, env: {}, ...f});
        assert.equal(code, 0);
        const [{cmd, args, opts}] = f.calls;
        assert.equal(cmd, "claude");
        assert.deepEqual(args.slice(0, 2), ["--model", "claude-fable-5-1"]);
        assert.equal(args[2], "--append-system-prompt");
        assert.match(args[3], /--apply/);
        assert.match(args[4], /#213 #295/);
        assert.equal(opts.env.PIPELINE_STATE_FILE, "var/pipeline/supervisor.json");
        assert.equal(opts.cwd, REPO);
    });
    test("--epic names the epic, and PIPELINE_MODEL_SUPERVISOR picks the model", async () => {
        const f = fakes();
        const env = {PIPELINE_MODEL_SUPERVISOR: "claude-opus-5-5"};
        assert.equal(await main(["--epic", "93"], {root: REPO, env, ...f}), 0);
        const [{args}] = f.calls;
        assert.equal(args[1], "claude-opus-5-5");
        assert.match(args[4], /epic #93/);
    });
    test("no issue and no epic is a usage error", async () => {
        const f = fakes();
        assert.equal(await main([], {root: REPO, env: {}, ...f}), 2);
        assert.equal(f.calls.length, 0);
    });
});

describe("--apply", () => {
    test("applies the kept patch in a worktree, commits, pushes as builder, clears waiting", async () => {
        const root = rootWithPatch(PATCH);
        const f = fakes();
        assert.equal(await main(["--apply", "516"], {root, env: {}, ...f}), 0);
        const steps = f.calls.map(c => [c.cmd, ...c.args.slice(0, 3)].join(" "));
        assert.deepEqual(steps, [
            "git ls-remote --heads origin",
            "git fetch origin 516-supervisor",
            "git worktree add --detach",
            "git apply --index " + path.join(root, "var", "pipeline", "protected", "516.patch"),
            "gh-as builder --git commit",
            "gh-as builder --push HEAD:refs/heads/516-supervisor",
            "git worktree remove --force"
        ]);
        assert.equal(f.calls[3].cwd, "/tmp/wt-516");
        assert.equal(f.calls[4].cwd, "/tmp/wt-516");
        assert.ok(!fs.existsSync(path.join(root, "var", "pipeline", "protected", "516.patch")));
        assert.equal(waiting(root), false);
    });
    test("refuses a patch with a path outside .claude/ and runs nothing", async () => {
        const root = rootWithPatch("diff --git a/src/a.js b/src/a.js\n");
        const f = fakes();
        assert.equal(await main(["--apply", "516"], {root, env: {}, ...f}), 1);
        assert.equal(f.calls.length, 0);
        assert.match(f.text.err, /src\/a\.js/);
        assert.ok(fs.existsSync(path.join(root, "var", "pipeline", "protected", "516.patch")));
        assert.equal(waiting(root), true);
    });
    test("a push that fails keeps the patch and the wait, and removes the worktree", async () => {
        const root = rootWithPatch(PATCH);
        const f = fakes({fail: "--push"});
        assert.equal(await main(["--apply", "516"], {root, env: {}, ...f}), 1);
        assert.equal(f.calls.at(-1).args.slice(0, 2).join(" "), "worktree remove");
        assert.ok(fs.existsSync(path.join(root, "var", "pipeline", "protected", "516.patch")));
        assert.equal(waiting(root), true);
    });
    test("no kept patch is an error", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "sv-"));
        const f = fakes();
        assert.equal(await main(["--apply", "516"], {root, env: {}, ...f}), 1);
        assert.match(f.text.err, /no kept patch/);
    });
});
