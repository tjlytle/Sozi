#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The factory loop on the host: every stage of every due issue runs in a container, and
// the loop judges what each session asked for when it ends.
//
//   node bin/pipeline.js [watch]        pass after pass until the stop condition holds
//   node bin/pipeline.js --once         one pass
//   node bin/pipeline.js <#>            one issue in the foreground, until its session ends
//   node bin/pipeline.js --status       sessions, tries, queued labels, totals
//   node bin/pipeline.js --digest       finish the run's Notion page
//   node bin/pipeline.js --build-image  build the stage image
//   options: --until <6h|90m|07:00>  --epic <#>  --harness <name>
//
// Settings come from pipeline/config, var/pipeline/env and PIPELINE_* variables; the state
// lives in var/pipeline/state.json. Ctrl-C saves the state and leaves running containers
// to finish; the next start adopts them.

import crypto from "node:crypto";
import path from "node:path";
import {parseArgs} from "node:util";
import {fileURLToPath, pathToFileURL} from "node:url";
import {loadConfig} from "../pipeline/lib/config.js";
import {createGithub, defaultRun} from "../pipeline/lib/github.js";
import {startMint} from "../pipeline/lib/mint.js";
import {createPass} from "../pipeline/lib/pass.js";
import {createSandbox} from "../pipeline/lib/sandbox.js";
import {emptyState, loadState, saveState} from "../pipeline/lib/state.js";
import {statusText} from "../pipeline/lib/status.js";
import {sync as boardSync} from "./board.js";
import {main as digestMain, notion, runs} from "./digest.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIRST_DELAY_S = 30;
const MAX_DELAY_S = 600;
const POLL_S = 15;
const DEFAULT_MINT_PORT = 7311;
const BRIDGE_FALLBACK = "172.17.0.1";

const USAGE = [
    "usage: node bin/pipeline.js [watch | --once | <#> | --status | --digest | --build-image]",
    "                            [--until <6h|90m|07:00>] [--epic <#>] [--harness <name>]"
];

/** Read an --until value: a duration from now (6h, 90m) or the next time of day (07:00).
 *
 * @param {string} text - The value.
 * @param {Date} now - The current time.
 * @returns {Date} - When no new session may start.
 * @throws {Error} - When the value is neither form.
 */
export function parseUntil(text, now) {
    const duration = /^(\d+)([hm])$/.exec(text);
    if (duration) {
        const unit = duration[2] === "h" ? 3600 * 1000 : 60 * 1000;
        return new Date(now.getTime() + Number(duration[1]) * unit);
    }
    const time = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (time && Number(time[1]) < 24 && Number(time[2]) < 60) {
        const at = new Date(now);
        at.setHours(Number(time[1]), Number(time[2]), 0, 0);
        if (at <= now) {
            at.setDate(at.getDate() + 1);
        }
        return at;
    }
    throw new Error(`--until takes 6h, 90m or HH:MM, not ${JSON.stringify(text)}`);
}

/** Wait.
 *
 * @param {number} seconds - How long.
 * @returns {Promise<void>}
 */
function sleep(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/** The address of the Docker bridge, which the mint binds to.
 *
 * @param {import("../pipeline/lib/github.js").Runner} run - The command runner.
 * @returns {Promise<string>} - The gateway address.
 */
async function bridgeAddress(run) {
    const r = await run([
        "docker",
        "network",
        "inspect",
        "bridge",
        "-f",
        "{{(index .IPAM.Config 0).Gateway}}"
    ]);
    const address = r.stdout.trim();
    return r.code === 0 && /^[\d.]+$/.test(address) ? address : BRIDGE_FALLBACK;
}

/** Load the state, starting a new run when the last one stopped.
 *
 * @param {string} file - The state file.
 * @param {Date} now - The current time.
 * @returns {any} - The state.
 */
function openState(file, now) {
    const state = loadState(file);
    if (!state.run.started || state.run.stopped) {
        state.run = {...emptyState().run, started: now.toISOString()};
    }
    return state;
}

/** Read the command line.
 *
 * @param {string[]} argv - The arguments after the script name.
 * @returns {{opt: Record<string, any>, target: string}} - The options, and "watch" or an issue number.
 * @throws {Error} - When the arguments do not parse.
 */
function parseCommand(argv) {
    const {values, positionals} = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            once: {type: "boolean"},
            status: {type: "boolean"},
            digest: {type: "boolean"},
            "build-image": {type: "boolean"},
            until: {type: "string"},
            epic: {type: "string"},
            harness: {type: "string"}
        }
    });
    const target = positionals[0] ?? "watch";
    if (positionals.length > 1 || !/^(watch|\d+)$/.test(target)) {
        throw new Error(`unexpected ${positionals.join(" ")}`);
    }
    if (values.epic !== undefined && !/^\d+$/.test(values.epic)) {
        throw new Error(`--epic takes an issue number, not ${JSON.stringify(values.epic)}`);
    }
    return {opt: values, target};
}

/** Write the closing summary to the run's Notion page, when there is one.
 *
 * @param {any} state - The loop state.
 * @param {string} reason - Why the run ends.
 * @param {Record<string, string|undefined>} env - The environment.
 * @param {(line: string) => void} log - The log.
 * @returns {Promise<void>}
 */
async function finishDigest(state, reason, env, log) {
    if (!state.run.notionPage || !env.NOTION_TOKEN) {
        log("digest: no page for this run");
        return;
    }
    const cost = Number(state.run.costUsd).toFixed(2);
    const summary = `Stopped: ${reason}. ${state.run.tokens} tokens, $${cost}.`;
    await digestMain(["finish", "--summary", summary], {
        env: {...env, PIPELINE_NOTION_PAGE: state.run.notionPage},
        err: log
    });
}

/** Open the run: the mint endpoint containers fetch tokens from, and the Notion page.
 *
 * @param {any} state - The loop state; gets mintKey, mintUrl and notionPage.
 * @param {any} settings - The settings.
 * @param {Record<string, string|undefined>} env - The environment.
 * @param {(line: string) => void} log - The log.
 * @returns {Promise<{close: () => Promise<void>}>} - The mint endpoint.
 */
async function openRun(state, settings, env, log) {
    const adopting =
        Object.values(state.issues).some((/** @type {any} */ r) => r.session) ||
        (state.run.sessions ?? []).length > 0;
    if (!adopting || !state.run.mintKey) {
        state.run.mintKey = crypto.randomBytes(32).toString("hex");
    }
    const mint = await startMint({
        port: settings.mintPort || DEFAULT_MINT_PORT,
        host: await bridgeAddress(defaultRun),
        key: state.run.mintKey,
        repos: [settings.repo],
        log: e => log(`mint ${e.bot} ${e.status}${e.reason ? ` ${e.reason}` : ""}`)
    });
    state.run.mintUrl = `http://host.docker.internal:${mint.port}/`;
    if (state.run.notionPage) {
        return mint;
    }
    if (!settings.notionParent || !env.NOTION_TOKEN) {
        log("digest: PIPELINE_NOTION_PARENT or NOTION_TOKEN unset; no Notion page");
        return mint;
    }
    let page = "";
    const title = `Sozi pipeline ${state.run.started.slice(0, 16)}`;
    await digestMain(["start", "--title", title, "--parent", settings.notionParent], {
        env,
        out: text => (page += text),
        err: log
    });
    state.run.notionPage = page.trim() || null;
    return mint;
}

/** The digest the pass adds notes to: a plain paragraph on the run's page, no checkbox.
 *
 * @param {any} state - The loop state.
 * @param {Record<string, string|undefined>} env - The environment.
 * @returns {{add: (entry: {issue: number, text: string}) => Promise<void>}} - The digest.
 */
function noteDigest(state, env) {
    return {
        async add({issue, text}) {
            const token = env.NOTION_TOKEN;
            if (!state.run.notionPage || !token) {
                return;
            }
            const line = issue ? `#${issue} ${text}` : text;
            const children = [
                {object: "block", type: "paragraph", paragraph: {rich_text: runs(line)}}
            ];
            const where = `/blocks/${state.run.notionPage}/children`;
            await notion("PATCH", where, {children}, {token});
        }
    };
}

/** Build the pass over the real GitHub, board, digest and clock.
 *
 * @param {object} parts - The run's parts.
 * @param {any} parts.state - The loop state.
 * @param {any} parts.settings - The settings.
 * @param {any} parts.sandbox - The sandbox.
 * @param {Record<string, string|undefined>} parts.env - The environment.
 * @param {string} parts.root - The repository root.
 * @param {(line: string) => void} parts.log - The log.
 * @param {() => void} parts.save - Writes the state.
 * @returns {{pass: (options?: {start?: boolean}) => Promise<any>}} - The pass.
 */
function loopPass({state, settings, sandbox, env, root, log, save}) {
    const ctx = {repo: settings.repo, run: defaultRun, out: log, err: log};
    return createPass({
        settings,
        state,
        github: createGithub({repo: settings.repo}),
        sandbox,
        board: {sync: options => boardSync(options, ctx)},
        digest: noteDigest(state, env),
        clock: {now: () => Date.now()},
        log,
        root,
        save
    });
}

/** Pass after pass until the stop condition holds, backing off while nothing happens.
 *
 * @param {(options?: {start?: boolean}) => Promise<any>} pass - The pass.
 * @returns {Promise<string>} - Why the run stopped.
 */
async function watch(pass) {
    let delay = FIRST_DELAY_S;
    for (;;) {
        const s = await pass();
        if (s.stopped) {
            return s.stopped;
        }
        const busy = s.started.length + s.finished.length + s.spawns > 0;
        delay = busy ? FIRST_DELAY_S : Math.min(delay * 2, MAX_DELAY_S);
        await sleep(delay);
    }
}

/** Run the command line.
 *
 * @param {string[]} argv - The arguments after the script name.
 * @param {object} [io] - Where things come from and go to.
 * @param {Record<string, string|undefined>} [io.env] - The environment.
 * @param {string} [io.root] - The repository root.
 * @param {(text: string) => void} [io.out] - Standard output.
 * @param {(text: string) => void} [io.err] - Standard error.
 * @returns {Promise<number>} - The exit status.
 */
export async function main(argv, {env = process.env, root = ROOT, out, err} = {}) {
    const write = out ?? (text => void process.stdout.write(text));
    const writeErr = err ?? (text => void process.stderr.write(text));
    const file = path.join(root, "var", "pipeline", "state.json");
    /**
     * Write a log line with the time.
     *
     * @param {string} line - The line.
     * @returns {void}
     */
    const log = line => write(`${new Date().toISOString().slice(11, 19)} ${line}\n`);
    let opt, target, settings;
    try {
        ({opt, target} = parseCommand(argv));
        settings = loadConfig({
            root,
            env: opt.harness ? {...env, PIPELINE_HARNESS: opt.harness} : env
        });
        opt.until = opt.until ? parseUntil(opt.until, new Date()).toISOString() : null;
    } catch (error) {
        writeErr(
            `${error instanceof Error ? error.message : String(error)}\n${USAGE.join("\n")}\n`
        );
        return 2;
    }
    if (opt.status || opt.digest) {
        const state = loadState(file);
        await (opt.status
            ? write(statusText(state))
            : finishDigest(state, "finished by hand", env, log));
        return 0;
    }
    const sandbox = createSandbox({settings, root});
    if (opt["build-image"]) {
        await sandbox.buildImage();
        return 0;
    }

    const state = openState(file, new Date());
    state.run.until = opt.until ?? state.run.until;
    state.run.epic = opt.epic ? Number(opt.epic) : state.run.epic;
    state.run.only = target === "watch" ? null : Number(target);
    const save = () => saveState(file, state);
    const mint = await openRun(state, settings, env, log);
    save();
    const {pass} = loopPass({state, settings, sandbox, env, root, log, save});
    process.on("SIGINT", () => {
        save();
        log("interrupted; state saved, containers keep running");
        process.exit(0);
    });
    try {
        if (opt.once) {
            const s = await pass();
            log(`started ${s.started.join(",") || "-"}; finished ${s.finished.join(",") || "-"}`);
            return 0;
        }
        if (target !== "watch") {
            return await one(Number(target), {pass, state, sandbox, settings, log});
        }
        const reason = await watch(pass);
        state.run.stopped = true;
        save();
        await finishDigest(state, reason, env, log);
        write(`stopped: ${reason}\n`);
        return 0;
    } finally {
        await mint.close();
    }
}

/** Run one issue in the foreground: start it, wait for its container, judge it.
 *
 * @param {number} n - The issue number.
 * @param {object} loop - The loop parts.
 * @param {(options?: {start?: boolean}) => Promise<any>} loop.pass - The pass.
 * @param {any} loop.state - The state.
 * @param {any} loop.sandbox - The sandbox.
 * @param {any} loop.settings - The settings.
 * @param {(line: string) => void} loop.log - The log.
 * @returns {Promise<number>} - The exit status.
 */
async function one(n, {pass, state, sandbox, settings, log}) {
    await pass();
    const session = state.issues[n]?.session;
    if (!session) {
        log(`#${n} has no session: it is not due, or the start failed`);
        state.run.only = null;
        return 1;
    }
    const cap = Date.parse(session.started) + settings.sessionMinutes * 60 * 1000;
    while (
        (await sandbox.status(session.container)) === "running" &&
        (settings.sessionMinutes === 0 || Date.now() <= cap)
    ) {
        await sleep(POLL_S);
    }
    state.run.only = null;
    const s = await pass({start: false});
    for (const [issue, from, to] of s.moved) {
        log(`#${issue}: ${from} -> ${to}`);
    }
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(await main(process.argv.slice(2)));
}
