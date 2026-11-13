/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The containers stages run in: the bare mirror they clone from, the image, and the
// docker commands that start, watch and remove them. Every command goes through an
// injectable runner. The arguments come from container-args.js, the outbox from
// outbox-prepare.js and the profile runs from profile.js.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {defaultRun} from "./github.js";
import {consultArgs, loginArgs, startArgs, startEnv} from "./container-args.js";
import {prepareOutbox} from "./outbox-prepare.js";
import {copyProfile, inspectProfile} from "./profile.js";

/**
 * Run a command with the terminal attached.
 *
 * @param {string[]} cmd - The command and its arguments.
 * @returns {number} The exit status; 1 when the command did not run to an exit.
 */
function spawnInteractive(cmd) {
    return spawnSync(cmd[0], cmd.slice(1), {stdio: "inherit"}).status ?? 1;
}

/**
 * @typedef {import("./github.js").Runner} Runner
 * @typedef {import("./container-args.js").StartOptions} StartOptions
 */

/**
 * @typedef {object} Sandbox
 * @property {() => Promise<void>} refreshMirror - Clones the mirror once, then updates it.
 * @property {() => Promise<void>} buildImage - Builds the stage image.
 * @property {(opts: StartOptions) => string[]} startArgs - The docker run arguments.
 * @property {(opts: StartOptions) => Promise<string>} start - Starts a container; resolves to its id.
 * @property {(container: string) => Promise<"running" | "exited" | "gone" | "unknown">} status - A container's state; unknown when docker itself fails.
 * @property {(container: string) => Promise<void>} stop - Stops a container, ten seconds' grace.
 * @property {(container: string) => Promise<void>} remove - Removes a container.
 * @property {(persona: string) => Promise<import("./profile.js").ProfileInfo | null>} inspectProfile - What a persona's profile holds; null when it has no volume.
 * @property {(opts: {persona: string, harness: string}) => string[]} loginArgs - The docker run arguments of an interactive login.
 * @property {(opts: {persona: string, harness: string}) => Promise<number>} login - Runs the login container with the terminal attached; resolves to its exit status.
 * @property {(opts: {from: string, to: string}) => Promise<void>} copyProfile - Copies one persona's profile volume, without its Claude login, into a new volume for another; refuses when the source has no volume or the target has one, and removes the target when the copy fails.
 * @property {(opts: {key: string, checkout: string, out: string, session: string | null, model: string}) => Promise<number>} consult - Runs one advisor call in a short container under the architect's profile: the claude adapter, with checkout as its working directory and out as its outbox, resuming the session when one is named; resolves to the exit status.
 * @property {(opts: {issue: number, stage: string, prompt: string, allow: string, carryFrom?: string, resume?: string, patches?: {from: string, names: string[]}}) => string} prepareOutbox - Writes a fresh outbox; returns its path. With carryFrom, the carry files of that stopped session's outbox are copied; with resume, the message is written as resume.md; with patches, the last try's patch files are copied into carried/.
 */

/**
 * Run a command and fail on a non-zero exit.
 *
 * @param {Runner} run - The command runner.
 * @param {string[]} cmd - The command.
 * @param {{env?: Record<string, string>}} [opts] - Extra environment.
 * @returns {Promise<string>} Standard output.
 */
async function must(run, cmd, opts) {
    const r = await run(cmd, opts);
    if (r.code !== 0) {
        throw new Error(`${cmd.slice(0, 2).join(" ")} failed: ${r.stderr.trim().slice(0, 300)}`);
    }
    return r.stdout;
}

/**
 * Clone the bare mirror once, then update it.
 *
 * @param {{run: Runner, settings: any, varDir: string, mirror: string}} options - The
 *     runner, the loop settings, var/pipeline and the mirror's path.
 * @returns {Promise<void>}
 */
async function refreshMirror({run, settings, varDir, mirror}) {
    if (fs.existsSync(mirror)) {
        // No automatic gc: a gc while a container clones would race it.
        await must(run, ["git", "-c", "gc.auto=0", "-C", mirror, "remote", "update", "--prune"]);
        return;
    }
    fs.mkdirSync(varDir, {recursive: true});
    await must(run, [
        "git",
        "clone",
        "--mirror",
        `https://github.com/${settings.repo}.git`,
        mirror
    ]);
}

/**
 * Build the stage image from docker/factory/Dockerfile.
 *
 * @param {{run: Runner, settings: any, root: string}} options - The runner, the loop
 *     settings and the repository root.
 * @returns {Promise<void>}
 */
async function buildImage({run, settings, root}) {
    await must(run, [
        "docker",
        "build",
        "-t",
        settings.image,
        "--build-arg",
        `FACTORY_UID=${process.getuid?.() ?? 1000}`,
        "-f",
        path.join(root, "docker", "factory", "Dockerfile"),
        root
    ]);
}

/**
 * Create the sandbox for a repository checkout.
 *
 * @param {object} options - What the sandbox needs.
 * @param {any} options.settings - The loop settings from loadConfig.
 * @param {string} options.root - The repository root; var/pipeline lives under it.
 * @param {Runner} [options.run] - The command runner.
 * @param {Record<string, string | undefined>} [options.env] - The loop's environment with the
 *     secrets of var/pipeline/env; the names docker passes on are taken from it.
 * @param {(cmd: string[]) => number | Promise<number>} [options.runInteractive] - Runs a
 *     command with the terminal attached and returns its exit status.
 * @param {string} [options.botConfigDir] - The host gh-bot directory the commit identities
 *     are copied from; ~/.config/gh-bot by default.
 * @returns {Sandbox} The sandbox.
 */
export function createSandbox({
    settings,
    root,
    run = defaultRun,
    env: loopEnv = {},
    runInteractive = spawnInteractive,
    botConfigDir = path.join(os.homedir(), ".config", "gh-bot")
}) {
    const varDir = path.join(root, "var", "pipeline");
    const mirror = path.join(varDir, "mirror.git");
    const image = settings.image;
    return {
        refreshMirror: () => refreshMirror({run, settings, varDir, mirror}),
        buildImage: () => buildImage({run, settings, root}),
        startArgs: opts => startArgs(settings, mirror, opts),
        loginArgs: opts => loginArgs(image, opts),
        login: async opts => runInteractive(["docker", ...loginArgs(image, opts)]),
        copyProfile: ({from, to}) => copyProfile(run, {image, from, to}),
        inspectProfile: persona => inspectProfile(run, {image, persona}),
        async start(opts) {
            const cmd = ["docker", ...startArgs(settings, mirror, opts)];
            const env = startEnv(settings, loopEnv, opts);
            return (await must(run, cmd, {env})).trim();
        },
        async consult(opts) {
            const {args, env} = consultArgs(settings, loopEnv, opts);
            return (await run(["docker", ...args], {env})).code;
        },
        async status(container) {
            const r = await run(["docker", "inspect", "-f", "{{.State.Status}}", container]);
            if (r.code !== 0) {
                return /No such (object|container)/i.test(r.stderr) ? "gone" : "unknown";
            }
            return ["exited", "dead"].includes(r.stdout.trim()) ? "exited" : "running";
        },
        async stop(container) {
            await run(["docker", "stop", "-t", "10", container]);
        },
        async remove(container) {
            await run(["docker", "rm", "-f", container]);
        },
        prepareOutbox: opts => prepareOutbox(varDir, botConfigDir, opts)
    };
}
