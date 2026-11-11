// test/pipeline/harness-adapter.js: what the adapter tests share to run an adapter over the fakes.
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The root of the checkout. */
export const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8"
}).trim();

/** The fake claude CLI. */
export const fake = path.join(root, "test/fixtures/pipeline/fake-claude");
const fakeCodex = path.join(root, "test/fixtures/pipeline/fake-codex");
const fakeAgy = path.join(root, "test/fixtures/pipeline/fake-agy");

/**
 * A scratch dir holding prompt.md, allow.txt and message.md.
 * @returns {string} the dir
 */
export function scratch() {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-"));
    fs.writeFileSync(path.join(out, "prompt.md"), "hello");
    fs.writeFileSync(path.join(out, "message.md"), "fix the lint");
    fs.writeFileSync(path.join(out, "allow.txt"), "# comment\nRead\n\nBash(npm *)\n");
    return out;
}

/**
 * Run an adapter with the fake CLIs.
 * @param {string} name adapter name
 * @param {string[]} args arguments after the adapter path
 * @param {Record<string, string>} env extra environment
 * @returns {import("node:child_process").SpawnSyncReturns<string>} the finished process
 */
export function adapter(name, args, env = {}) {
    /** @type {Record<string, string | undefined>} */
    const e = {...process.env, CLAUDE_BIN: fake, CODEX_BIN: fakeCodex, AGY_BIN: fakeAgy};
    delete e.PIPELINE_SESSION_BUDGET_USD;
    Object.assign(e, env);
    return spawnSync("bash", [path.join(root, `pipeline/harness/${name}`), ...args], {
        env: e,
        encoding: "utf8"
    });
}

/**
 * The arguments for a run in dir.
 * @param {string} dir scratch dir
 * @returns {string[]} the arguments
 */
export function runArgs(dir) {
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
 * Parse usage.json in dir.
 * @param {string} dir scratch dir
 * @returns {any} the parsed usage
 */
export function usageOf(dir) {
    return JSON.parse(fs.readFileSync(path.join(dir, "usage.json"), "utf8"));
}
