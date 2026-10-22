/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The pass's GitHub side: label writes that queue while GitHub backs the loop off,
// stage moves, the timed sync, and unblocking issues whose blockers closed.

import {RateLimited, blockedBy} from "./github.js";
import {applyIssue, queueLabel, scope, setStage, stageOf, takeQueuedLabels, wake} from "./state.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_SYNC_DAYS = 90;
const STAGE_LABELS = /^stage:/;

/**
 * @typedef {object} Summary
 * @property {number[]} started - Issues whose session started this pass.
 * @property {number[]} finished - Issues whose session finished this pass.
 * @property {[number, string | null, string][]} moved - Stage moves the loop made: issue, from, to.
 * @property {number[]} parked - Issues parked this pass.
 * @property {number} spawns - Spawned sessions started or finished this pass.
 * @property {string | null} stopped - Why the run stops, or null while it goes on.
 */

/**
 * @typedef {object} PassContext
 * @property {any} settings - The settings from loadConfig.
 * @property {import("./state.js").State & {boardMeta?: any}} state - The loop state, changed in place.
 * @property {import("./github.js").Github} github - The GitHub client.
 * @property {any} sandbox - The sandbox.
 * @property {{sync: (opts: {issues: number[], all?: boolean, book: any}) => Promise<{failed: number[]} | void>}} board - The board; sync names the issues it failed on.
 * @property {{add: (entry: {issue: number, text: string}) => Promise<unknown>}} digest - The run digest.
 * @property {{now: () => number}} clock - The clock, in epoch milliseconds.
 * @property {(line: string) => void} log - The log.
 * @property {string} root - The repository root, where the prompts live.
 * @property {Set<number>} changed - Issues whose stage changed since the last board sync, or whose board sync failed.
 * @property {number} syncs - GitHub syncs since the loop started; the first and every boardFullEvery-th sync the whole board.
 * @property {Set<number>} tried - Issues that used a try, or whose persona is busy or profile refused, this pass; they wait for the next.
 * @property {Map<string, import("./start.js").ProfileVerdict>} profiles - The verdict on each persona's profile this pass.
 * @property {Record<string, string | undefined>} env - The loop's environment, where the model tokens are read.
 * @property {Summary} summary - The summary of the running pass.
 * @property {() => void} save - Writes the state.
 */

/**
 * Tell whether GitHub has backed the loop off.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {boolean} True until the back-off time.
 */
export function inBackoff(ctx) {
    const until = ctx.state.sync.backoffUntil;
    return until !== null && ctx.clock.now() < Date.parse(until);
}

/**
 * Remember a rate-limit reply: no GitHub calls until it resets.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {RateLimited} error - The reply.
 * @returns {void}
 */
export function backOff(ctx, error) {
    const reset = error.resetAt instanceof Date ? error.resetAt.getTime() : ctx.clock.now();
    ctx.state.sync.backoffUntil = new Date(reset).toISOString();
    ctx.log(`GitHub rate limit: backing off until ${ctx.state.sync.backoffUntil}`);
}

/**
 * Write a label change to GitHub now, or queue it while backed off, while an earlier
 * write about the same issue waits in the queue (so the order holds), or when it fails.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {{issue: number, add?: string[], remove?: string[]}} op - The change.
 * @returns {Promise<void>}
 */
export async function writeLabel(ctx, {issue, add = [], remove = []}) {
    const op = {issue, add, remove};
    if (inBackoff(ctx) || hasQueued(ctx, issue)) {
        queueLabel(ctx.state, op);
        return;
    }
    try {
        await ctx.github.label(op);
    } catch (error) {
        if (error instanceof RateLimited) {
            backOff(ctx, error);
        } else {
            ctx.log(`#${issue}: label change failed, queued: ${String(error)}`);
        }
        queueLabel(ctx.state, op);
    }
}

/**
 * Move an issue to a stage, or out of the stages to triage, in the state and on GitHub.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {string} to - A stage label, or "triage".
 * @returns {Promise<void>}
 */
export async function moveStage(ctx, n, to) {
    const record = ctx.state.issues[n];
    const from = record.stage;
    if (to === "triage") {
        record.labels = [...record.labels.filter(l => !STAGE_LABELS.test(l)), "triage"];
        record.stage = null;
        record.tries = 0;
        record.waiting = false;
    } else {
        setStage(ctx.state, n, to);
    }
    await writeLabel(ctx, {issue: n, add: [to], remove: from && from !== to ? [from] : []});
    ctx.summary.moved.push([n, from, to]);
    ctx.changed.add(n);
}

/**
 * Apply a label request: GitHub, and the state when the loop knows the issue.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {{issue: number, add: string[], remove: string[]}} op - The change.
 * @returns {Promise<boolean>} Whether the issue's stage changed.
 */
export async function applyLabels(ctx, op) {
    await writeLabel(ctx, op);
    const record = ctx.state.issues[op.issue];
    if (!record) {
        return false;
    }
    const labels = [...record.labels.filter(l => !op.remove.includes(l)), ...op.add];
    const from = record.stage;
    const to = stageOf(labels);
    record.labels = [...new Set(labels)];
    if (to === from) {
        return false;
    }
    record.stage = to;
    record.tries = 0;
    record.waiting = false;
    ctx.summary.moved.push([op.issue, from, to ?? "none"]);
    ctx.changed.add(op.issue);
    return true;
}

/**
 * Write the queued label changes and comments. A rate limit stops the drain and keeps the
 * rest; any other refusal moves that one write to the dead letters and the drain goes on.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {Promise<boolean>} True when the queue is empty.
 */
async function drainQueue(ctx) {
    const queued = takeQueuedLabels(ctx.state);
    for (let i = 0; i < queued.length; i++) {
        const op = queued[i];
        try {
            if ("comment" in op) {
                await ctx.github.comment(op.comment.persona, op.comment.issue, op.comment.body);
            } else {
                await ctx.github.label(op);
            }
        } catch (error) {
            if (error instanceof RateLimited) {
                ctx.state.queued.push(...queued.slice(i));
                backOff(ctx, error);
                return false;
            }
            const message = error instanceof Error ? error.message : String(error);
            ctx.log(`dead letter ${JSON.stringify(op)}: ${message}`);
            (ctx.state.deadLetters ??= []).push({op, error: message});
        }
    }
    return true;
}

/**
 * Write the queued writes when GitHub has not backed the loop off; every pass starts
 * with this, so a queued write never lands after a newer direct one.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {Promise<void>}
 */
export async function drainIfFree(ctx) {
    if (ctx.state.queued.length > 0 && !inBackoff(ctx)) {
        await drainQueue(ctx);
    }
}

/**
 * Tell whether a write about an issue is still waiting in the queue.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @returns {boolean} True when the queue holds a label change or comment for it.
 */
export function hasQueued(ctx, n) {
    return ctx.state.queued.some(op => ("comment" in op ? op.comment.issue : op.issue) === n);
}

/**
 * Take one issue from a GitHub search into the state: read the blockers of a newly
 * blocked issue, and wake a parked one whose newest comment is a person's and, when the
 * loop parked it, came after the parking.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {import("./github.js").Issue} issue - The issue as GitHub has it.
 * @returns {Promise<void>}
 */
async function readIssue(ctx, issue) {
    const {state, github} = ctx;
    const n = issue.number;
    const existing = state.issues[n];
    const stage = stageOf(issue.labels);
    /** @type {any} */
    const read = {...issue};
    if (
        stage === "stage:blocked" &&
        (!existing || existing.stage !== stage || existing.blockers.length === 0)
    ) {
        read.blockedBy = blockedBy((await github.planComment(n)) ?? "");
    }
    const parkedAt = existing?.parkedAt ?? null;
    const humanAt =
        stage === "stage:parked" && (!existing || existing.seen !== issue.updatedAt)
            ? await github.lastHumanCommentAt(n)
            : null;
    const answered =
        humanAt !== null && (parkedAt === null || Date.parse(humanAt) > Date.parse(parkedAt));
    applyIssue(state, read);
    if (!existing || existing.stage !== stage) {
        ctx.changed.add(n);
    }
    if (answered) {
        const to = wake(state, n);
        await writeLabel(ctx, {issue: n, add: [to], remove: ["stage:parked"]});
        ctx.summary.moved.push([n, "stage:parked", to]);
        ctx.changed.add(n);
        ctx.log(`#${n}: a person answered; back to ${to}`);
    }
}

/**
 * Read GitHub when the sync timer is due and the loop is not backed off: queued label
 * changes first (so the read sees them), then the issues, blockers of blocked issues,
 * parked issues a person answered; then stale working labels go, blocked issues with no
 * blockers are logged, and the board syncs.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {Promise<void>}
 */
export async function syncIfDue(ctx) {
    const {state, settings, github} = ctx;
    const now = ctx.clock.now();
    const last = state.sync.last === null ? null : Date.parse(state.sync.last);
    if ((last !== null && now < last + settings.syncMinutes * 60 * 1000) || inBackoff(ctx)) {
        return;
    }
    try {
        if (!(await drainQueue(ctx))) {
            return;
        }
        const since = state.sync.last ?? new Date(now - FIRST_SYNC_DAYS * DAY_MS).toISOString();
        for (const issue of await github.searchIssues({since})) {
            await readIssue(ctx, issue);
        }
        state.sync.last = new Date(now).toISOString();
    } catch (error) {
        if (error instanceof RateLimited) {
            backOff(ctx, error);
        } else {
            ctx.log(`sync failed: ${String(error)}`);
        }
        return;
    }
    await sweepWorking(ctx);
    blockedByNothing(ctx);
    await syncBoard(ctx);
}

/**
 * Drop the working label of every issue with no session: a session ended without the
 * removal reaching GitHub, or someone else left it.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {Promise<void>}
 */
async function sweepWorking(ctx) {
    for (const [key, record] of Object.entries(ctx.state.issues)) {
        if (record.labels.includes("working") && !record.session) {
            ctx.log(`#${key}: working with no session; removing the label`);
            record.labels = record.labels.filter(l => l !== "working");
            await writeLabel(ctx, {issue: Number(key), add: [], remove: ["working"]});
        }
    }
}

/**
 * Log each open blocked issue in scope that names no blockers: it is quiet, and only a
 * person can say what it waits for.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {void}
 */
function blockedByNothing(ctx) {
    const {state} = ctx;
    for (const n of scope(state, {epic: state.run.epic})) {
        const r = state.issues[n];
        if (r.stage === "stage:blocked" && !r.closed && r.blockers.length === 0) {
            ctx.log(`#${n}: blocked by nothing; it waits for a person to name its blockers`);
        }
    }
}

/**
 * Sync the board for the issues whose stage changed, or the whole board on the first
 * sync and every boardFullEvery-th; the issues it failed on wait for the next sync.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {Promise<void>}
 */
async function syncBoard(ctx) {
    ctx.syncs += 1;
    const every = ctx.settings.boardFullEvery;
    const all = ctx.syncs === 1 || (every > 0 && (ctx.syncs - 1) % every === 0);
    if (!all && ctx.changed.size === 0) {
        return;
    }
    try {
        const result = await ctx.board.sync({issues: [...ctx.changed], all, book: ctx.state});
        ctx.changed = new Set(result?.failed ?? []);
    } catch (error) {
        ctx.log(`board sync failed: ${String(error)}`);
    }
}

/**
 * Move every blocked issue in scope whose blockers are all closed to stage:tests, where it
 * is due.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {Promise<void>}
 */
export async function unblock(ctx) {
    const {state} = ctx;
    const scoped = state.run.epic ? scope(state, {epic: state.run.epic}) : null;
    for (const [key, record] of Object.entries(state.issues)) {
        if (
            (!scoped || scoped.includes(Number(key))) &&
            record.stage === "stage:blocked" &&
            !record.closed &&
            record.blockers.length > 0 &&
            record.blockers.every(b => state.issues[b]?.closed === true)
        ) {
            ctx.log(`#${key}: blockers closed; to stage:tests`);
            await moveStage(ctx, Number(key), "stage:tests");
        }
    }
}
