/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Judging a session that ended: its usage, its requests, and whether it moved its
// issue. A session that moved nothing is a try; enough tries park the issue.

import {RateLimited, blockedBy} from "./github.js";
import {logTail} from "./outbox.js";
import {readRequests} from "./requests.js";
import {park, promptFor, recordTry, stageOf} from "./state.js";
import {applyLabels, backOff, hasQueued, inBackoff, moveStage, writeLabel} from "./sync.js";
import {allowedMoves, costsNoTry, takeResult, unverifiedReason} from "./verdict.js";

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 * @typedef {import("./requests.js").Request} Request
 * @typedef {import("./verdict.js").Outcome} Outcome
 */

/**
 * Log notes (and add them to the digest) and refused requests.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {Request[]} accepted - The accepted requests.
 * @param {{file: string, reason: string}[]} refused - The refused ones.
 * @param {number} issue - The issue the notes are about, or 0.
 * @param {string} who - The session, for the log.
 * @returns {Promise<void>}
 */
async function notesAndRefusals(ctx, accepted, refused, issue, who) {
    for (const request of accepted) {
        if (request.kind === "note") {
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
 * Read the blockers of an issue the session just blocked, so unblock() can act; the
 * next sync reads them instead while GitHub backs the loop off.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @returns {Promise<void>}
 */
async function readBlockers(ctx, n) {
    if (inBackoff(ctx)) {
        return;
    }
    try {
        ctx.state.issues[n].blockers = blockedBy((await ctx.github.planComment(n)) ?? "");
    } catch (error) {
        if (error instanceof RateLimited) {
            backOff(ctx, error);
        }
    }
}

/**
 * Comment as ops now, or queue the comment while backed off or when it fails.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {string} body - The comment.
 * @returns {Promise<void>}
 */
async function writeComment(ctx, n, body) {
    if (!inBackoff(ctx)) {
        try {
            await ctx.github.comment("ops", n, body);
            return;
        } catch (error) {
            if (error instanceof RateLimited) {
                backOff(ctx, error);
            }
            ctx.log(`#${n}: comment failed, queued: ${String(error)}`);
        }
    }
    ctx.state.queued.push({comment: {persona: "ops", issue: n, body}});
}

/**
 * Count a try for an issue that did not move; on the last, park it, note when, and
 * comment (or queue the comment).
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
    state.issues[n].parkedAt = new Date(ctx.clock.now()).toISOString();
    const text =
        `Pipeline: the ${promptFor(stage) ?? stage} stage ended ${tries} times without moving ` +
        `this issue, so I am parking it. @${settings.human}, the log tail:\n\n` +
        "```\n" +
        `${logTail(outbox)}\n` +
        "```\n";
    await writeComment(ctx, n, text);
    await writeLabel(ctx, {issue: n, add: ["stage:parked"], remove: stage ? [stage] : []});
    ctx.summary.moved.push([n, stage, "stage:parked"]);
    ctx.summary.parked.push(n);
    ctx.changed.add(n);
}

/**
 * Tell whether the issue's stage was changed on GitHub by hand; adopt it when it was.
 * While backed off, or while a write about the issue waits in the queue, GitHub is not
 * read and the answer is no.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @returns {Promise<boolean>} True when GitHub shows another stage.
 */
async function movedByHand(ctx, n) {
    const record = ctx.state.issues[n];
    if (inBackoff(ctx) || hasQueued(ctx, n)) {
        return false;
    }
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
 * Apply the requests of an issue's session. A done request must name a move the stage
 * the session ran may make; any other is refused and the session moved nothing.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {Request[]} accepted - The accepted requests.
 * @param {string | null} unverified - Why they cannot be trusted, if so.
 * @returns {Promise<{moved: boolean, wait: string | null}>} Whether the issue moved, and why it waits for a person.
 */
async function applyRequests(ctx, n, accepted, unverified) {
    const stage = ctx.state.issues[n].session.stage;
    let moved = false;
    /** @type {string | null} */
    let wait = null;
    for (const request of accepted) {
        if (request.kind === "note") {
            continue;
        }
        if (unverified) {
            ctx.log(`#${n}: ${request.kind} request ignored: ${unverified}`);
        } else if (request.kind === "done") {
            const allowed = allowedMoves(stage);
            if (!allowed.includes(request.to)) {
                ctx.log(
                    `#${n}: refused done to ${request.to}: a ${stage} session moves to ` +
                        allowed.join(", ")
                );
                continue;
            }
            await moveStage(ctx, n, request.to);
            moved = true;
            if (request.to === "stage:blocked") {
                await readBlockers(ctx, n);
            }
        } else if (request.kind === "label") {
            const changed = await applyLabels(ctx, request);
            moved ||= changed && request.issue === n;
        } else if (request.kind === "wait") {
            wait = request.reason;
        } else {
            queueSpawn(ctx, request, `#${n}`);
        }
    }
    return {moved, wait};
}

/**
 * Judge an issue's ended session: usage, requests, and a try when it moved nothing,
 * unless it asked to wait for a person or the model's usage limit stopped it.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {Outcome} outcome - How the session ended.
 * @returns {Promise<void>}
 */
async function judgeIssue(ctx, n, outcome) {
    const record = ctx.state.issues[n];
    const {outbox} = record.session;
    const who = `#${n}`;
    const result = takeResult(ctx, outbox, who);
    const unverified = unverifiedReason(result, outcome);
    if (unverified) {
        ctx.log(`${who}: unverified session: ${unverified}`);
    }
    const {accepted, refused} = readRequests(outbox, {issue: n});
    const {moved, wait} = await applyRequests(ctx, n, accepted, unverified);
    await notesAndRefusals(ctx, accepted, refused, n, who);
    if (moved) {
        return;
    }
    if (costsNoTry(result)) {
        ctx.log(`${who}: usage ${result?.usage.status}; no try, stays at ${record.stage}`);
    } else if (wait !== null) {
        record.waiting = true;
        ctx.log(`${who}: waiting for a person at ${record.stage}: ${wait}`);
        await ctx.digest.add({issue: n, text: `waits for a person: ${wait}`}).catch(error => {
            ctx.log(`${who}: digest note failed: ${String(error)}`);
        });
    } else if (unverified || !(await movedByHand(ctx, n))) {
        await countTry(ctx, n, outbox);
    }
}

/**
 * Judge an issue's ended session once and free its slot. The session is marked judged
 * (and saved) first, so a loop that dies half way never applies its requests twice, and
 * the verdict is saved as soon as it is reached.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {Outcome} [outcome] - How the session ended.
 * @returns {Promise<void>}
 */
export async function finishIssue(ctx, n, outcome = "exited") {
    const record = ctx.state.issues[n];
    const session = record.session;
    if (session.judged) {
        ctx.log(`#${n}: session already judged; cleaning up`);
    } else {
        session.judged = true;
        ctx.save();
        try {
            await judgeIssue(ctx, n, outcome);
        } catch (error) {
            ctx.log(`#${n}: finishing failed: ${String(error)}`);
        }
        ctx.save();
    }
    record.labels = record.labels.filter(l => l !== "working");
    await writeLabel(ctx, {issue: n, add: [], remove: ["working"]});
    await ctx.sandbox.remove(session.container).catch(() => {});
    record.session = null;
    ctx.summary.finished.push(n);
}

/**
 * Judge a spawned session that ended, once, and free its slot. Its done and wait requests
 * were refused, since a spawned session has no stage, and its spawns are refused: a
 * spawned session may not spawn again.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {{container: string, outbox: string, persona: string, judged?: boolean}} session - The session.
 * @param {Outcome} [outcome] - How the session ended.
 * @returns {Promise<void>}
 */
export async function finishSpawn(ctx, session, outcome = "exited") {
    const who = `spawn ${session.persona}`;
    if (!session.judged) {
        session.judged = true;
        ctx.save();
        try {
            const result = takeResult(ctx, session.outbox, who);
            const unverified = unverifiedReason(result, outcome);
            const {accepted, refused} = readRequests(session.outbox, {issue: 0});
            for (const request of accepted) {
                if (unverified && request.kind !== "note") {
                    ctx.log(`${who}: ${request.kind} request ignored: ${unverified}`);
                } else if (request.kind === "label") {
                    await applyLabels(ctx, request);
                } else if (request.kind === "spawn") {
                    ctx.log(
                        `${who}: refused spawn ${request.persona}: spawns go one deep (depth 1)`
                    );
                }
            }
            await notesAndRefusals(ctx, accepted, refused, 0, who);
        } catch (error) {
            ctx.log(`${who}: finishing failed: ${String(error)}`);
        }
    }
    await ctx.sandbox.remove(session.container).catch(() => {});
    ctx.state.run.sessions = ctx.state.run.sessions.filter((/** @type {any} */ s) => s !== session);
    ctx.summary.spawns++;
}
