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
//   node bin/pipeline.js --login <persona> [--harness claude|codex|opencode]
//                                       log a persona in inside a container
//   node bin/pipeline.js --copy-profile <from> <to>
//                                       copy one persona's profile, without its login, to another
//   options: --until <6h|90m|07:00>  --epic <#>  --harness <name>
//
// Settings come from pipeline/config, var/pipeline/env and PIPELINE_* variables; the state
// lives in var/pipeline/state.json. A first Ctrl-C or SIGTERM starts nothing more and waits,
// the mint still up, until every running session has ended and been judged. A second one
// saves the state and leaves the sessions running; the next start adopts them.

import {spawnSync} from "node:child_process";
import path from "node:path";
import {parseArgs} from "node:util";
import {fileURLToPath, pathToFileURL} from "node:url";
import {loadConfig} from "../pipeline/lib/config.js";
import {createGithub, defaultRun} from "../pipeline/lib/github.js";
import {startMint} from "../pipeline/lib/mint.js";
import {createControl, drain, hookSignals, watch} from "../pipeline/lib/loop.js";
import {createPass} from "../pipeline/lib/pass.js";
import {finishDigest, noteDigest, openRun} from "../pipeline/lib/run.js";
import {SettingsWatch} from "../pipeline/lib/settings-watch.js";
import {PERSONAS} from "../pipeline/lib/profile.js";
import {createSandbox} from "../pipeline/lib/sandbox.js";
import {emptyState, loadState, saveState} from "../pipeline/lib/state.js";
import {profilesText, statusText} from "../pipeline/lib/status.js";
import {sync as boardSync} from "./board.js";
import {main as digestMain} from "./digest.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = [
    "usage: node bin/pipeline.js [watch | --once | <#> | --status | --digest | --build-image]",
    "                            [--until <6h|90m|07:00>] [--epic <#>] [--harness <name>]",
    "       node bin/pipeline.js --login <persona> [--harness claude|codex|opencode]   log a persona in inside a container",
    "       node bin/pipeline.js --copy-profile <from> <to>   copy one persona's profile, without its login, to another"
];

/**
 * @typedef {object} Deps
 * @property {import("../pipeline/lib/github.js").Runner} run - Runs commands on the host.
 * @property {(cmd: string[]) => number | Promise<number>} runInteractive - Runs a command with the terminal attached; resolves to its exit status.
 * @property {typeof startMint} startMint - Starts the mint endpoint.
 * @property {typeof digestMain} digest - The digest command line.
 * @property {any} [github] - The GitHub client; the real one when absent.
 * @property {any} [board] - The board; the real one when absent.
 * @property {any} [sandbox] - The sandbox; the real one when absent.
 * @property {((seconds: number) => Promise<void>) | undefined} sleep - A wait instead of a timer.
 * @property {(handler: (signal: string) => void) => () => void} onSignal - Hooks SIGINT and SIGTERM; returns the unhook.
 * @property {() => number} now - The clock, in milliseconds.
 * @property {(code: number) => void} exit - Ends the process.
 */

/** @type {Deps} */
const DEFAULT_DEPS = {
    run: defaultRun,
    runInteractive: cmd => spawnSync(cmd[0], cmd.slice(1), {stdio: "inherit"}).status ?? 1,
    startMint,
    digest: digestMain,
    sleep: undefined,
    onSignal: handler => hookSignals(handler),
    now: () => Date.now(),
    exit: code => process.exit(code)
};

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

/** Load the state, starting a new run when the last one stopped. The new run keeps what
 * is still alive: spawned sessions, queued spawns and the mint key the sessions hold.
 *
 * @param {string} file - The state file.
 * @param {Date} now - The current time.
 * @returns {any} - The state.
 */
function openState(file, now) {
    const state = loadState(file);
    if (!state.run.started || state.run.stopped) {
        const {sessions, spawns, mintKey} = state.run;
        state.run = {
            ...emptyState().run,
            started: now.toISOString(),
            sessions,
            spawns,
            mintKey: mintKey ?? null
        };
    }
    return state;
}

/** Check a persona name.
 *
 * @param {string} persona - The name.
 * @throws {Error} - When it is not a persona.
 */
function checkPersona(persona) {
    if (!PERSONAS.includes(persona)) {
        throw new Error(`persona must be one of ${PERSONAS.join("|")}`);
    }
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
            login: {type: "string"},
            "copy-profile": {type: "boolean"},
            until: {type: "string"},
            epic: {type: "string"},
            harness: {type: "string"}
        }
    });
    if (values["copy-profile"]) {
        if (positionals.length !== 2) {
            throw new Error("--copy-profile takes <from> <to>");
        }
        positionals.forEach(checkPersona);
        return {opt: {...values, copy: positionals}, target: "watch"};
    }
    if (values.login !== undefined) {
        checkPersona(values.login);
        if (!["claude", "codex", "opencode"].includes(values.harness ?? "claude")) {
            throw new Error("harness must be one of claude|codex|opencode");
        }
    }
    const target = positionals[0] ?? "watch";
    if (positionals.length > 1 || !/^(watch|\d+)$/.test(target)) {
        throw new Error(`unexpected ${positionals.join(" ")}`);
    }
    if (values.epic !== undefined && !/^\d+$/.test(values.epic)) {
        throw new Error(`--epic takes an issue number, not ${JSON.stringify(values.epic)}`);
    }
    return {opt: values, target};
}

/** Inspect every persona profile, an error standing in for a persona that cannot be inspected.
 *
 * @param {ReturnType<typeof createSandbox>} sandbox - The sandbox.
 * @returns {Promise<Array<{persona: string, info: import("../pipeline/lib/profile.js").ProfileInfo | null | Error}>>} - One entry per persona.
 */
async function inspectAll(sandbox) {
    return Promise.all(
        PERSONAS.map(async persona => {
            try {
                return {persona, info: await sandbox.inspectProfile(persona)};
            } catch (error) {
                return {persona, info: error instanceof Error ? error : new Error(String(error))};
            }
        })
    );
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
 * @param {() => void} parts.reload - Rereads the settings before each pass.
 * @param {Deps} parts.deps - The outside world.
 * @returns {{pass: (options?: {start?: boolean}) => Promise<any>}} - The pass.
 */
function loopPass({state, settings, sandbox, env, root, log, save, reload, deps}) {
    const ctx = {repo: settings.repo, run: deps.run, out: log, err: log};
    return createPass({
        settings,
        state,
        github: deps.github ?? createGithub({repo: settings.repo}),
        sandbox,
        board: deps.board ?? {sync: options => boardSync(options, ctx)},
        digest: noteDigest(state, env),
        clock: {now: () => Date.now()},
        env,
        log,
        root,
        save,
        reload
    });
}

/** Finish the run by hand: post its closing summary and mark it stopped, so the next start
 * opens a new run. A run already finished posts nothing; a failed post leaves it open.
 *
 * @param {string} file - The state file.
 * @param {Omit<Parameters<typeof finishDigest>[0], "state" | "reason">} options - The run.
 * @returns {Promise<void>}
 */
async function digestByHand(file, options) {
    const state = loadState(file);
    if (state.run.stopped) {
        options.log("digest: this run is already finished");
        return;
    }
    if (await finishDigest({...options, state, reason: "finished by hand"})) {
        state.run.stopped = true;
        saveState(file, state);
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
 * @param {Partial<Deps>} [io.deps] - Fakes for the outside world, for tests.
 * @returns {Promise<number>} - The exit status.
 */
export async function main(
    argv,
    {env = process.env, root = ROOT, out, err, deps: fakes = {}} = {}
) {
    /** @type {Deps} */
    const deps = {...DEFAULT_DEPS, ...fakes};
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
    let opt, target, settings, configEnv;
    try {
        ({opt, target} = parseCommand(argv));
        configEnv =
            opt.harness && opt.login === undefined ? {...env, PIPELINE_HARNESS: opt.harness} : env;
        settings = loadConfig({root, env: configEnv});
        opt.until = opt.until ? parseUntil(opt.until, new Date()).toISOString() : null;
    } catch (error) {
        writeErr(
            `${error instanceof Error ? error.message : String(error)}\n${USAGE.join("\n")}\n`
        );
        return 2;
    }
    // The environment wins over the secrets file, as it does for the settings.
    const runEnv = {...settings.secrets, ...env};
    const sandbox =
        deps.sandbox ??
        createSandbox({
            settings,
            root,
            run: deps.run,
            runInteractive: deps.runInteractive,
            env: runEnv
        });
    if (opt.status) {
        write(statusText(loadState(file)) + profilesText(await inspectAll(sandbox)));
        return 0;
    }
    if (opt.digest) {
        await digestByHand(file, {settings, root, env: runEnv, log, deps});
        return 0;
    }
    if (opt["build-image"]) {
        await sandbox.buildImage();
        return 0;
    }

    if (opt.login !== undefined) {
        return sandbox.login({persona: opt.login, harness: opt.harness ?? "claude"});
    }
    if (opt["copy-profile"]) {
        const [from, to] = opt.copy;
        try {
            await sandbox.copyProfile({from, to});
        } catch (error) {
            writeErr(`${error instanceof Error ? error.message : String(error)}\n`);
            return 1;
        }
        write(
            `copied ${from} to ${to} without the Claude login: run npm run pipeline -- --login ${to} once\n`
        );
        return 0;
    }

    const state = openState(file, new Date());
    // A restart keeps the run but not its limits: they hold only when given again.
    state.run.until = opt.until;
    state.run.epic = opt.epic ? Number(opt.epic) : null;
    state.run.only = target === "watch" ? null : Number(target);
    const save = () => saveState(file, state);
    const mint = await openRun(state, settings, runEnv, log, deps);
    save();
    const settingsWatch = new SettingsWatch({root, env: configEnv, settings, runEnv, log});
    const reload = () => settingsWatch.refresh();
    const {pass} = loopPass({
        state,
        settings,
        sandbox,
        env: runEnv,
        root,
        log,
        save,
        reload,
        deps
    });
    const control = createControl({
        sleep: deps.sleep,
        save,
        exit: deps.exit,
        log,
        state,
        now: deps.now
    });
    const unhook = deps.onSignal(() => control.interrupt());
    let code = 0;
    try {
        if (target !== "watch" || opt.once) {
            await pass();
            const n = state.run.only;
            state.run.only = null;
            if (n !== null && !state.issues[n]?.session) {
                log(`#${n} has no session: it is not due, or the start failed`);
                code = 1;
            }
        } else {
            const reason = await watch(pass, control, log, save);
            if (reason !== null) {
                state.run.stopped = true;
                save();
                await finishDigest({state, reason, settings, root, env: runEnv, log, deps});
                write(`stopped: ${reason}\n`);
            }
        }
        await drain(pass, state, control, log);
        save();
        return code;
    } finally {
        unhook();
        await mint.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(await main(process.argv.slice(2)));
}
