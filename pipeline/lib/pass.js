/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// One pass of the factory loop, as a function the watch loop, --once and a single issue
// all call: reap ended sessions, refresh the mirror, sync with GitHub when due, unblock,
// test the stop condition, start what is due, save.

import path from "node:path";
import {fileURLToPath} from "node:url";
import {ceiling, isQuiet, scope} from "./state.js";
import {finishIssue, finishSpawn} from "./finish.js";
import {running, start} from "./start.js";
import {syncIfDue, unblock} from "./sync.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 * @typedef {import("./sync.js").Summary} Summary
 */

/**
 * @typedef {object} PassOptions
 * @property {any} settings - The settings from loadConfig.
 * @property {import("./state.js").State} state - The loop state, changed in place.
 * @property {import("./github.js").Github} github - The GitHub client.
 * @property {any} sandbox - The sandbox from createSandbox.
 * @property {PassContext["board"]} board - The board, whose sync takes {issues, book}.
 * @property {PassContext["digest"]} digest - The digest, whose add takes {issue, text}.
 * @property {{now: () => number}} clock - The clock, in epoch milliseconds.
 * @property {(line: string) => void} log - The log.
 * @property {string} [root] - The repository root, where pipeline/*.md live; this checkout when absent.
 * @property {() => void} [save] - Writes the state; called at the end of every pass.
 */

/**
 * Find out whether a session ended, stopping it past the wall-clock cap.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {{container: string, started: string}} session - The session.
 * @returns {Promise<boolean>} True when it ended and should be judged.
 */
async function ended(ctx, session) {
    const minutes = ctx.settings.sessionMinutes;
    const status = await ctx.sandbox.status(session.container);
    const overdue =
        minutes > 0 && ctx.clock.now() - Date.parse(session.started) > minutes * 60 * 1000;
    if (status === "running" && overdue) {
        ctx.log(`${session.container}: past ${minutes} minutes; stopping`);
        await ctx.sandbox.stop(session.container);
        return true;
    }
    return status !== "running";
}

/**
 * Judge every session that ended, for issues and spawned ones.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {Promise<void>}
 */
async function reap(ctx) {
    for (const [key, record] of Object.entries(ctx.state.issues)) {
        if (record.session && (await ended(ctx, record.session))) {
            await finishIssue(ctx, Number(key));
        }
    }
    for (const session of [...ctx.state.run.sessions]) {
        if (await ended(ctx, session)) {
            await finishSpawn(ctx, session);
        }
    }
}

/**
 * Test the stop condition: nothing due in scope, or no more starts and nothing running.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {{noStarts: boolean, stopped: string | null}} Whether starts are over and why the run stops.
 */
function stopCheck(ctx) {
    const {state, settings} = ctx;
    const untilPassed = state.run.until !== null && ctx.clock.now() >= Date.parse(state.run.until);
    const noStarts = untilPassed || ceiling(state, settings) === "hard";
    const idle = running(ctx) === 0;
    const scoped = scope(state, {epic: state.run.epic});
    if (idle && state.run.spawns.length === 0 && isQuiet(state, scoped)) {
        return {noStarts, stopped: "nothing is due"};
    }
    if (idle && noStarts) {
        return {noStarts, stopped: untilPassed ? "until reached" : "hard ceiling reached"};
    }
    return {noStarts, stopped: null};
}

/**
 * Create the pass over a state.
 *
 * @param {PassOptions} options - What the pass works with.
 * @returns {{pass: (options?: {start?: boolean}) => Promise<Summary>}} The pass; `start: false` only judges and syncs.
 */
export function createPass({root = REPO_ROOT, save = () => {}, ...parts}) {
    const {state} = parts;
    state.run.spawns ??= [];
    state.run.sessions ??= [];
    state.run.only ??= null;
    /** @type {PassContext} */
    const ctx = {...parts, root, changed: new Set(), tried: new Set(), summary: emptySummary()};
    return {
        async pass({start: starts = true} = {}) {
            ctx.summary = emptySummary();
            ctx.tried.clear();
            await reap(ctx);
            try {
                await ctx.sandbox.refreshMirror();
            } catch (error) {
                ctx.log(`mirror refresh failed: ${String(error)}`);
            }
            await syncIfDue(ctx);
            await unblock(ctx);
            const {noStarts, stopped} = stopCheck(ctx);
            if (starts && !stopped && !noStarts) {
                await start(ctx);
            }
            ctx.summary.stopped = stopped;
            save();
            return ctx.summary;
        }
    };
}

/**
 * A summary of a pass that did nothing yet.
 *
 * @returns {Summary} The summary.
 */
function emptySummary() {
    return {started: [], finished: [], moved: [], parked: [], spawns: 0, stopped: null};
}
