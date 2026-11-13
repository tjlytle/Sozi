#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The supervisor (#516): an interactive Claude Code session that runs the issues labelled
// supervised, stage by stage, and asks Tim for what a stage may not do.
//
//   npm run supervise -- <#>...         supervise these issues
//   npm run supervise -- --epic <#>     supervise the supervised issues of an epic
//   npm run supervise -- --apply <#>    commit the kept protected patch of an issue to its
//                                       branch and push it as builder, once Tim said yes
//
// The session keeps its own loop state in var/pipeline/supervisor.json (PIPELINE_STATE_FILE),
// apart from a running loop's. Protected patches wait in var/pipeline/protected/<#>.patch.

import {execFile, spawn as spawnChild} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {loadConfig} from "../pipeline/lib/config.js";
import {loadState, saveState} from "../pipeline/lib/state.js";
import {protectedPatchPaths} from "../pipeline/lib/supervised.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = "var/pipeline/supervisor.json";
const USAGE = "usage: npm run supervise -- <#>... | --epic <#> | --apply <#>\n";

/**
 * @typedef {object} Deps
 * @property {(cmd: string, args: string[], opts: {env: Record<string, string | undefined>, cwd: string}) => Promise<number>} spawn - Runs a command with the terminal attached; resolves to its exit status.
 * @property {(cmd: string, args: string[], opts?: {cwd?: string}) => Promise<{code: number, stdout: string, stderr: string}>} run - Runs a command and captures its output.
 * @property {() => string} tmpdir - A new empty directory.
 */

/** @type {Deps} */
const DEFAULT_DEPS = {
    spawn: (cmd, args, {env, cwd}) =>
        new Promise(resolve => {
            const child = spawnChild(cmd, args, {env, cwd, stdio: "inherit"});
            child.on("error", () => resolve(127));
            child.on("close", code => resolve(code ?? 1));
        }),
    run: (cmd, args, {cwd} = {}) =>
        new Promise(resolve => {
            execFile(cmd, args, {cwd, maxBuffer: 64 * 1024 * 1024}, (error, stdout, stderr) => {
                /** @type {any} */
                const e = error;
                resolve({code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout, stderr});
            });
        }),
    tmpdir: () => fs.mkdtempSync(path.join(os.tmpdir(), "supervise-"))
};

/**
 * Start the supervisor session on the supervisor model, with its prompt appended to the
 * system prompt and its own state file.
 *
 * @param {string} task - The first message: which issues to supervise.
 * @param {{root: string, env: Record<string, string | undefined>, deps: Deps}} ctx - Where it runs.
 * @returns {Promise<number>} - The session's exit status.
 */
async function launch(task, {root, env, deps}) {
    const settings = loadConfig({root, env});
    const prompt = fs.readFileSync(path.join(root, "pipeline", "supervisor", "PROMPT.md"), "utf8");
    const args = ["--model", settings.supervisorModel, "--append-system-prompt", prompt, task];
    return deps.spawn("claude", args, {env: {...env, PIPELINE_STATE_FILE: STATE_FILE}, cwd: root});
}

/**
 * Run a command and throw when it fails.
 *
 * @param {Deps} deps - The outside world.
 * @param {string} cmd - The command.
 * @param {string[]} args - Its arguments.
 * @param {string} [cwd] - Where it runs.
 * @returns {Promise<string>} - Its output.
 * @throws {Error} - When it exits non-zero; the message holds its error output.
 */
async function must(deps, cmd, args, cwd) {
    const result = await deps.run(cmd, args, {cwd});
    if (result.code !== 0) {
        throw new Error(`${cmd} ${args.slice(0, 2).join(" ")} failed: ${result.stderr.trim()}`);
    }
    return result.stdout;
}

/**
 * The one branch of an issue on origin, named `<n>-<slug>`.
 *
 * @param {Deps} deps - The outside world.
 * @param {number} n - The issue number.
 * @returns {Promise<string>} - The branch name.
 * @throws {Error} - When there is none, or more than one.
 */
async function issueBranch(deps, n) {
    const out = await must(deps, "git", ["ls-remote", "--heads", "origin", `refs/heads/${n}-*`]);
    const branches = out
        .split("\n")
        .map(line => /\trefs\/heads\/(\S+)$/.exec(line)?.[1])
        .filter(b => b !== undefined);
    if (branches.length !== 1) {
        throw new Error(`#${n} has ${branches.length} branches on origin; expected one`);
    }
    return /** @type {string} */ (branches[0]);
}

/**
 * Commit a checked patch to an issue's branch in a temporary worktree and push it as
 * builder. The worktree is removed whatever happens.
 *
 * @param {Deps} deps - The outside world.
 * @param {number} n - The issue number.
 * @param {string} patchFile - The kept patch.
 * @param {string[]} paths - The paths it changes.
 * @returns {Promise<string>} - The branch it was pushed to.
 */
async function commitPatch(deps, n, patchFile, paths) {
    const branch = await issueBranch(deps, n);
    await must(deps, "git", ["fetch", "origin", branch]);
    const dir = deps.tmpdir();
    await must(deps, "git", ["worktree", "add", "--detach", dir, "FETCH_HEAD"]);
    try {
        await must(deps, "git", ["apply", "--index", patchFile], dir);
        const message =
            `Apply the protected patch Tim approved for #${n}\n\n` +
            `A stage may not write under .claude/; the supervisor asked and Tim said yes.\n` +
            `Paths: ${paths.join(", ")}\n`;
        await must(deps, "gh-as", ["builder", "--git", "commit", "-m", message], dir);
        await must(deps, "gh-as", ["builder", "--push", `HEAD:refs/heads/${branch}`], dir);
    } finally {
        await deps.run("git", ["worktree", "remove", "--force", dir]);
    }
    return branch;
}

/**
 * Apply the protected patch kept for an issue: check every path is under .claude/ again,
 * commit and push it, then delete it and clear the issue's wait in the supervisor's state.
 *
 * @param {number} n - The issue number.
 * @param {{root: string, deps: Deps, out: (text: string) => void}} ctx - Where it runs.
 * @returns {Promise<void>}
 * @throws {Error} - When there is no patch, it names a path outside .claude/, or a step fails.
 */
async function apply(n, {root, deps, out}) {
    const patchFile = path.join(root, "var", "pipeline", "protected", `${n}.patch`);
    if (!fs.existsSync(patchFile)) {
        throw new Error(`#${n} has no kept patch (${patchFile})`);
    }
    const paths = protectedPatchPaths(fs.readFileSync(patchFile, "utf8"));
    const branch = await commitPatch(deps, n, patchFile, paths);
    fs.rmSync(patchFile);
    const stateFile = path.join(root, STATE_FILE);
    const state = loadState(stateFile);
    if (state.issues[n]) {
        state.issues[n].waiting = false;
        saveState(stateFile, state);
    }
    out(`#${n}: ${paths.join(", ")} pushed to ${branch}\n`);
}

/**
 * Run the command line.
 *
 * @param {string[]} argv - The arguments after the script name.
 * @param {object} [io] - Where things come from and go to.
 * @param {Record<string, string | undefined>} [io.env] - The environment.
 * @param {string} [io.root] - The repository root.
 * @param {(text: string) => void} [io.out] - Standard output.
 * @param {(text: string) => void} [io.err] - Standard error.
 * @param {Partial<Deps>} [io.deps] - Fakes for the outside world, for tests.
 * @returns {Promise<number>} - The exit status: 2 for a usage error, 1 when --apply failed.
 */
export async function main(argv, {env = process.env, root = ROOT, out, err, deps = {}} = {}) {
    const ctx = {
        root,
        env,
        deps: {...DEFAULT_DEPS, ...deps},
        out: out ?? (text => void process.stdout.write(text))
    };
    const writeErr = err ?? (text => void process.stderr.write(text));
    const [first, second] = argv;
    if ((first === "--apply" || first === "--epic") && !/^\d+$/.test(second ?? "")) {
        writeErr(USAGE);
        return 2;
    }
    if (first === "--apply") {
        try {
            await apply(Number(second), ctx);
            return 0;
        } catch (error) {
            writeErr(`supervise: ${error instanceof Error ? error.message : String(error)}\n`);
            return 1;
        }
    }
    if (first === "--epic") {
        return launch(`Supervise the supervised issues of epic #${second}.`, ctx);
    }
    if (argv.length === 0 || !argv.every(a => /^\d+$/.test(a))) {
        writeErr(USAGE);
        return 2;
    }
    return launch(`Supervise ${argv.map(a => `#${a}`).join(" ")}.`, ctx);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(await main(process.argv.slice(2)));
}
