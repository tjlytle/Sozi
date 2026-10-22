/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Judging a session that ended: its usage, its requests, and whether it moved its
// issue. A session that moved nothing is a try; enough tries park the issue.

import fs from "node:fs";
import path from "node:path";
import {RateLimited, blockedBy} from "./github.js";
import {readRequests, readResult} from "./requests.js";
import {addUsage, park, promptFor, recordTry, stageOf} from "./state.js";
import {applyLabels, backOff, moveStage, writeLabel} from "./sync.js";

const LOG_TAIL_LINES = 20;

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 * @typedef {import("./requests.js").Request} Request
 */

/**
 * The last lines of a session's log.
 *
 * @param {string} outbox - The outbox directory.
 * @returns {string} Up to twenty lines, or a note that there is no log.
 */
function logTail(outbox) {
    try {
        const lines = fs.readFileSync(path.join(outbox, "log"), "utf8").trimEnd().split("\n");
        return lines.slice(-LOG_TAIL_LINES).join("\n");
    } catch {
        return "(no log)";
    }
}

/**
 * Read a session's result and add its usage to the run; a rate-limited session backs the
 * loop off.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} outbox - The outbox directory.
 * @param {string} who - The session, for the log.
 * @returns {import("./requests.js").Result | null} The result, or null when there is none.
 */
function takeResult(ctx, outbox, who) {
    const result = readResult(outbox);
    if (!result) {
        ctx.log(`${who}: no result.json`);
        return null;
    }
    addUsage(ctx.state, {
        tokens: result.usage.tokensIn + result.usage.tokensOut,
        costUsd: result.usage.costUsd
    });
    if (result.usage.status === "rate-limited") {
        const until = new Date(
            ctx.clock.now() + ctx.settings.rateLimitBackoffMinutes * 60 * 1000
        ).toISOString();
        ctx.state.sync.backoffUntil = until;
        ctx.state.run.startsPausedUntil = until;
        ctx.log(`${who}: the model is rate limited; no starts until ${until}`);
    }
    if (result.hooks === "error") {
        ctx.log(`${who}: the outside checks crashed; the work is unverified`);
    }
    return result;
}

/**
 * Log notes (and add them to the digest) and refused requests.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {Request[]} accepted - The accepted requests.
 * @param {{file: string, reason: string}[]} refused - The refused ones.
 * @param {number} issue - The issue the notes are about, or 0.
 * @param {string} who - The session, for the log.
 * @returns {Promise<number>} How many notes there were.
 */
async function notesAndRefusals(ctx, accepted, refused, issue, who) {
    let notes = 0;
    for (const request of accepted) {
        if (request.kind === "note") {
            notes++;
            ctx.log(`${who} note: ${request.text}`);
            try {
                await ctx.digest.add({issue, text: request.text});
            } catch (error) {
                ctx.log(`${who}: digest note failed: ${String(error)}`);
            }
        }
    }
    for (const r of refused) {
        ctx.log(`${who}: refused ${r.file}: ${r.reason}`);
    }
    return notes;
}

/**
 * Queue a spawn request for start() to pick up.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {import("./requests.js").SpawnRequest} request - The request.
 * @param {string} who - The session, for the log.
 * @returns {void}
 */
function queueSpawn(ctx, request, who) {
    const {persona, prompt, issue, harness} = request;
    ctx.state.run.spawns.push({persona, prompt, issue: issue ?? null, harness: harness ?? null});
    ctx.log(`${who}: spawn ${persona} queued`);
}

/**
 * Read the blockers of an issue the session just blocked, so unblock() can act.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @returns {Promise<void>}
 */
async function readBlockers(ctx, n) {
    try {
        ctx.state.issues[n].blockers = blockedBy((await ctx.github.planComment(n)) ?? "");
    } catch (error) {
        if (error instanceof RateLimited) {
            backOff(ctx, error);
        }
    }
}

/**
 * Count a try for an issue that did not move; park it with a comment on the last.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {string} outbox - The outbox, for the log tail.
 * @returns {Promise<void>}
 */
async function countTry(ctx, n, outbox) {
    const {state, settings} = ctx;
    const stage = state.issues[n].stage;
    ctx.tried.add(n);
    const {tries, park: parks} = recordTry(state, n, settings.maxTries || undefined);
    ctx.log(`#${n}: no move from ${stage}; try ${tries}`);
    if (!parks) {
        return;
    }
    park(state, n);
    const text =
        `Pipeline: the ${promptFor(stage) ?? stage} stage ended ${tries} times without moving ` +
        `this issue, so I am parking it. @${settings.human}, the log tail:\n\n` +
        "```\n" +
        `${logTail(outbox)}\n` +
        "```\n";
    try {
        await ctx.github.comment("ops", n, text);
    } catch (error) {
        if (error instanceof RateLimited) {
            backOff(ctx, error);
        }
        ctx.log(`#${n}: parking comment failed: ${String(error)}`);
    }
    await writeLabel(ctx, {issue: n, add: ["stage:parked"], remove: stage ? [stage] : []});
    ctx.summary.moved.push([n, stage, "stage:parked"]);
    ctx.summary.parked.push(n);
    ctx.changed.add(n);
}

/**
 * Tell whether the issue's stage was changed on GitHub by hand; adopt it when it was.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @returns {Promise<boolean>} True when GitHub shows another stage.
 */
async function movedByHand(ctx, n) {
    const record = ctx.state.issues[n];
    let labels;
    try {
        labels = await ctx.github.labelsOf(n);
    } catch (error) {
        if (error instanceof RateLimited) {
            backOff(ctx, error);
        }
        return false;
    }
    const stage = stageOf(labels);
    if (stage === record.stage) {
        return false;
    }
    ctx.log(`#${n}: moved by hand from ${record.stage} to ${stage}`);
    record.labels = [...labels];
    record.stage = stage;
    record.tries = 0;
    record.waiting = false;
    ctx.changed.add(n);
    return true;
}

/**
 * Judge an issue's ended session and free its slot.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @returns {Promise<void>}
 */
export async function finishIssue(ctx, n) {
    const record = ctx.state.issues[n];
    const {container, outbox} = record.session;
    const who = `#${n}`;
    try {
        const result = takeResult(ctx, outbox, who);
        const unverified = result?.hooks === "error";
        const {accepted, refused} = readRequests(outbox, {issue: n});
        let moved = false;
        for (const request of accepted) {
            if (request.kind === "note") {
                continue;
            }
            if (unverified) {
                ctx.log(`${who}: ${request.kind} request ignored: the checks did not run`);
            } else if (request.kind === "done") {
                await moveStage(ctx, n, request.to);
                moved = true;
                if (request.to === "stage:blocked") {
                    await readBlockers(ctx, n);
                }
            } else if (request.kind === "label") {
                const changed = await applyLabels(ctx, request);
                moved ||= changed && request.issue === n;
            } else {
                queueSpawn(ctx, request, who);
            }
        }
        const notes = await notesAndRefusals(ctx, accepted, refused, n, who);
        if (!moved && !unverified && result?.exit === 0 && notes > 0) {
            record.waiting = true;
            ctx.log(`${who}: waiting for a person at ${record.stage}`);
        } else if (!moved && !(await movedByHand(ctx, n))) {
            await countTry(ctx, n, outbox);
        }
    } catch (error) {
        ctx.log(`${who}: finishing failed: ${String(error)}`);
    }
    record.labels = record.labels.filter(l => l !== "working");
    await writeLabel(ctx, {issue: n, add: [], remove: ["working"]});
    await ctx.sandbox.remove(container).catch(() => {});
    record.session = null;
    ctx.summary.finished.push(n);
}

/**
 * Judge a spawned session that ended and free its slot. Its done requests were refused,
 * since a spawned session has no stage.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {{container: string, outbox: string, persona: string}} session - The session.
 * @returns {Promise<void>}
 */
export async function finishSpawn(ctx, session) {
    const who = `spawn ${session.persona}`;
    try {
        const result = takeResult(ctx, session.outbox, who);
        const {accepted, refused} = readRequests(session.outbox, {issue: 0});
        for (const request of accepted) {
            if (result?.hooks === "error" && request.kind !== "note") {
                ctx.log(`${who}: ${request.kind} request ignored: the checks did not run`);
            } else if (request.kind === "label") {
                await applyLabels(ctx, request);
            } else if (request.kind === "spawn") {
                queueSpawn(ctx, request, who);
            }
        }
        await notesAndRefusals(ctx, accepted, refused, 0, who);
    } catch (error) {
        ctx.log(`${who}: finishing failed: ${String(error)}`);
    }
    await ctx.sandbox.remove(session.container).catch(() => {});
    ctx.state.run.sessions = ctx.state.run.sessions.filter((/** @type {any} */ s) => s !== session);
    ctx.summary.spawns++;
}
