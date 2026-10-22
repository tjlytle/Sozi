/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The containers stages run in: the bare mirror they clone from, the image, the
// outbox each session writes to, and the docker commands that start, watch and
// remove them. Every command goes through an injectable runner.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {defaultRun} from "./github.js";

/** Credentials (the mint key among them) and per-session values passed by name, so Docker reads them from the
 * environment of the docker command and they never appear in a process listing.
 */
const BY_NAME = [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "NOTION_TOKEN",
    "PIPELINE_NOTION_PAGE",
    "PIPELINE_EVIDENCE_ACCOUNT",
    "PIPELINE_EVIDENCE_BUCKET",
    "PIPELINE_EVIDENCE_TOKEN",
    "PIPELINE_EVIDENCE_URL",
    "PIPELINE_RUN",
    "PIPELINE_ISSUE",
    "GH_MINT_KEY"
];

const MAX_RESUMES = "3";

/**
 * @typedef {import("./github.js").Runner} Runner
 */

/**
 * @typedef {object} StartOptions
 * @property {number} issue - The issue number; 0 for a spawned session with no issue.
 * @property {string} stage - The prompt stage name: plan, tests, build, review, qa or spawn.
 * @property {string} outbox - The host directory mounted at /outbox.
 * @property {string} mintUrl - The mint endpoint as the container reaches it.
 * @property {string} mintKey - The run's mint credential.
 * @property {string} [harness] - The harness; the stage's setting when absent.
 * @property {string} [model] - The model; the stage's setting when absent.
 * @property {string} [tag] - A suffix that keeps the container name unique.
 * @property {Date} [now] - The time the name carries; the current time when absent.
 * @property {Record<string, string>} [env] - Values for the names passed through, such as PIPELINE_ISSUE.
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
 * @property {(opts: {issue: number, stage: string, prompt: string, allow: string}) => string} prepareOutbox - Writes a fresh outbox; returns its path.
 */

/**
 * Two digits.
 *
 * @param {number} n - A number below 100.
 * @returns {string} The number, zero padded.
 */
function pad(n) {
    return String(n).padStart(2, "0");
}

/**
 * Find the gh-personas plugin directory the image build copies `bin` from.
 *
 * @returns {string} The first version directory in the plugin cache.
 * @throws {Error} When the plugin is not installed.
 */
function pluginDir() {
    const cache = path.join(os.homedir(), ".claude", "plugins", "cache", "dev-flow", "gh-personas");
    const versions = fs.existsSync(cache) ? fs.readdirSync(cache).sort() : [];
    const dir = versions.map(v => path.join(cache, v)).find(d => fs.statSync(d).isDirectory());
    if (!dir) {
        throw new Error(`the gh-personas plugin is not in ${cache}`);
    }
    return dir;
}

/**
 * Create the sandbox for a repository checkout.
 *
 * @param {object} options - What the sandbox needs.
 * @param {any} options.settings - The loop settings from loadConfig.
 * @param {string} options.root - The repository root; var/pipeline lives under it.
 * @param {Runner} [options.run] - The command runner.
 * @returns {Sandbox} The sandbox.
 */
export function createSandbox({settings, root, run = defaultRun}) {
    const varDir = path.join(root, "var", "pipeline");
    const mirror = path.join(varDir, "mirror.git");

    /**
     * Run a command and fail on a non-zero exit.
     *
     * @param {string[]} cmd - The command.
     * @param {{env?: Record<string, string>}} [opts] - Extra environment.
     * @returns {Promise<string>} Standard output.
     */
    async function must(cmd, opts) {
        const r = await run(cmd, opts);
        if (r.code !== 0) {
            throw new Error(
                `${cmd.slice(0, 2).join(" ")} failed: ${r.stderr.trim().slice(0, 300)}`
            );
        }
        return r.stdout;
    }

    /** @type {Sandbox["startArgs"]} */
    function startArgs({issue, stage, outbox, mintUrl, harness, model, tag, now}) {
        const at = now ?? new Date();
        const name = `factory-${issue}-${stage}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;
        const args = ["run", "-d", "--name", tag ? `${name}-${tag}` : name];
        args.push("--add-host=host.docker.internal:host-gateway");
        if (settings.memory) {
            args.push("--memory", settings.memory);
        }
        if (settings.cpus > 0) {
            args.push("--cpus", String(settings.cpus));
        }
        args.push("-v", `${mirror}:/mirror:ro`, "-v", `${outbox}:/outbox`);
        for (const name of BY_NAME) {
            args.push("-e", name);
        }
        const values = {
            GH_MINT_URL: mintUrl,
            PIPELINE_REPO: settings.repo,
            PIPELINE_HARNESS: harness ?? settings.harnessFor(stage),
            PIPELINE_MODEL: model ?? settings.modelFor(stage),
            PIPELINE_SESSION_BUDGET_USD: String(settings.sessionBudgetUsd),
            PIPELINE_MAX_RESUMES: MAX_RESUMES
        };
        for (const [key, value] of Object.entries(values)) {
            args.push("-e", `${key}=${value}`);
        }
        args.push(settings.image, "/pipeline/stage.sh", String(issue), stage);
        return args;
    }

    return {
        async refreshMirror() {
            if (fs.existsSync(mirror)) {
                await must(["git", "-C", mirror, "remote", "update", "--prune"]);
                return;
            }
            fs.mkdirSync(varDir, {recursive: true});
            await must([
                "git",
                "clone",
                "--mirror",
                `https://github.com/${settings.repo}.git`,
                mirror
            ]);
        },
        async buildImage() {
            await must([
                "docker",
                "build",
                "-t",
                settings.image,
                "--build-context",
                `ghp=${pluginDir()}`,
                path.join(root, "docker", "factory")
            ]);
        },
        startArgs,
        async start(opts) {
            const ev = settings.evidence;
            /** @type {Record<string, string>} */
            const env = {};
            const fromSettings = {
                PIPELINE_EVIDENCE_ACCOUNT: ev.account,
                PIPELINE_EVIDENCE_BUCKET: ev.bucket,
                PIPELINE_EVIDENCE_TOKEN: ev.token,
                PIPELINE_EVIDENCE_URL: ev.url
            };
            for (const [key, value] of Object.entries(fromSettings)) {
                if (value) {
                    env[key] = value;
                }
            }
            const out = await must(["docker", ...startArgs(opts)], {
                env: {...env, ...opts.env, GH_MINT_KEY: opts.mintKey}
            });
            return out.trim();
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
        prepareOutbox({issue, stage, prompt, allow}) {
            const at = new Date();
            const time = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;
            const base = path.join(varDir, `out-${issue}-${stage}-${time}`);
            fs.mkdirSync(varDir, {recursive: true});
            let dir = base;
            for (let n = 2; ; n++) {
                try {
                    fs.mkdirSync(dir);
                    break;
                } catch (error) {
                    if (/** @type {{code?: string}} */ (error).code !== "EEXIST") {
                        throw error;
                    }
                    dir = `${base}-${n}`;
                }
            }
            fs.writeFileSync(path.join(dir, "prompt.md"), prompt);
            fs.writeFileSync(path.join(dir, "allow.txt"), allow);
            return dir;
        }
    };
}
