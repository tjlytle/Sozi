/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Judging a session that ended: its usage, its requests, and whether it moved its
// issue. A session that moved nothing is a try; park.js counts it and parks the issue.

import {keepProtected, labelIfPlanned} from "./finish-supervised.js";
import {RateLimited, blockedBy} from "./github.js";
import {loggedOutLine, markLoggedOut} from "./logins.js";
import {listPatches, readResult} from "./outbox.js";
import {countTry, parkBranches, parkStub} from "./park.js";
import {personaFor} from "./profile.js";
import {readRequests} from "./requests.js";
import {applyRerun} from "./rerun.js";
import {keepLeftover, stageOf} from "./state.js";
import {
    applyLabels,
    backOff,
    hasQueued,
    inBackoff,
    moveStage,
    writeComment,
    writeLabel
} from "./sync.js";
import {usageComment} from "./usage-comment.js";
import {
    allowedMoves,
    costsNoTry,
    loggedOut,
    stubHarness,
    takeResult,
    unverifiedReason
} from "./verdict.js";

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
 * Mark a persona whose session's login died, so start() runs nothing more as it; the
 * line saying so is logged once.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} persona - The persona.
 * @returns {void}
 */
function markPersona(ctx, persona) {
    if (markLoggedOut(ctx.state, persona, new Date(ctx.clock.now()).toISOString())) {
        ctx.log(loggedOutLine(persona));
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
 * Post an ended session's usage comment on its issue as ops, or queue it. The harness and
 * model are the ones the session recorded at its start; a session saved before it did
 * takes them from the settings. A failure is logged and never undoes the verdict.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {{started: string, outbox: string, persona?: string, harness?: string, model?: string, advisor?: import("./advice.js").AdvisorTotal}} session - The session, with the advisor consults it made.
 * @param {{stage: string, try: number | null, outcome: Outcome}} how - Its stage, try and end.
 * @returns {Promise<void>}
 */
async function postUsage(ctx, n, session, {stage, try: attempt, outcome}) {
    const {settings} = ctx;
    const settingsStage = stage === "spawn" ? "qa" : stage;
    try {
        const body = usageComment({
            stage,
            try: attempt,
            persona: session.persona ?? personaFor(stage),
            harness: session.harness ?? settings.harnessFor(settingsStage),
            model: session.model ?? settings.modelFor(settingsStage),
            result: readResult(session.outbox),
            startedAt: session.started,
            endedAt: new Date(ctx.clock.now()).toISOString(),
            outcome,
            outbox: session.outbox,
            advisor: session.advisor
        });
        await writeComment(ctx, n, body);
    } catch (error) {
        ctx.log(`#${n}: usage comment failed: ${String(error)}`);
    }
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
    record.reruns = 0;
    record.waiting = false;
    ctx.changed.add(n);
    return true;
}

/**
 * Apply the requests of an issue's session. A done request must name a move the stage
 * the session ran may make; any other is refused and the session moved nothing. A plan's
 * done labels its issue supervised when the plan changes the pipeline or .claude/. A rerun
 * request goes to rerun.js, which checks it against GitHub.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {Request[]} accepted - The accepted requests.
 * @param {string | null} unverified - Why they cannot be trusted, if so.
 * @returns {Promise<{moved: boolean, wait: string | null, rerun: boolean}>} Whether the issue moved, why it waits for a person, and whether its CI run was rerun.
 */
async function applyRequests(ctx, n, accepted, unverified) {
    const stage = ctx.state.issues[n].session.stage;
    let moved = false;
    let rerun = false;
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
            if (stage === "plan") {
                await labelIfPlanned(ctx, n);
            }
        } else if (request.kind === "label") {
            const changed = await applyLabels(ctx, request);
            moved ||= changed && request.issue === n;
        } else if (request.kind === "wait") {
            wait = request.reason;
        } else if (request.kind === "rerun") {
            rerun = (await applyRerun(ctx, n, request)) || rerun;
        } else {
            queueSpawn(ctx, request, `#${n}`);
        }
    }
    return {moved, wait, rerun};
}

/**
 * What the next session of a stage needs from one its usage limit stopped: the outbox with its
 * carried work, and the harness session to resume. Only a session that ran with a profile can be
 * resumed; a token-only one keeps no transcript, so the next one starts fresh with the carry.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {any} session - The issue's session record.
 * @param {import("./outbox.js").Result | null} result - Its result.
 * @returns {import("./state.js").Interrupted} - The interruption.
 */
function interruption(ctx, session, result) {
    const {stage, outbox, harness = ctx.settings.harnessFor(stage)} = session;
    return {
        harness,
        model: session.model ?? ctx.settings.modelFor(stage),
        session: session.profile ? (result?.session ?? null) : null,
        outbox,
        persona: session.persona ?? personaFor(stage),
        stage
    };
}

/**
 * Judge an issue's ended session: usage, requests, and a try when it moved nothing,
 * unless it asked to wait for a person, the loop reran its CI run, or the model's usage
 * limit stopped it. A session the
 * usage limit stopped is recorded as interrupted, for the next session of its stage to carry
 * on; one whose carried work did not apply puts back the interruption it carried, and counts a
 * try. A session whose login died marks its persona logged out. A session on a stub harness
 * parks the issue at once, and so does one that found several issue branches and no PR head,
 * keeping the interruption it carried. A try that counts keeps the patches it left for the next
 * one. A protected patch is kept for the supervisor, and the issue waits for a person.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {Outcome} outcome - How the session ended.
 * @returns {Promise<void>}
 */
async function judgeIssue(ctx, n, outcome) {
    const record = ctx.state.issues[n];
    const {outbox, stage, harness = ctx.settings.harnessFor(stage)} = record.session;
    const who = `#${n}`;
    const result = takeResult(ctx, outbox, who, harness);
    if (result?.carry === "failed") {
        record.interrupted = record.session.carried ?? null;
        ctx.log(`${who}: the carried work did not apply; it is kept for the next session`);
    }
    if (result?.branches) {
        // The harness never ran, so the carried work was never applied: keep it.
        record.interrupted = record.session.carried ?? null;
    }
    const unverified = unverifiedReason(result, outcome);
    if (unverified) {
        ctx.log(`${who}: unverified session: ${unverified}`);
    }
    const {accepted, refused} = readRequests(outbox, {issue: n});
    const {moved, wait: asked, rerun} = await applyRequests(ctx, n, accepted, unverified);
    const kept = unverified ? null : await keepProtected(ctx, n, outbox);
    const wait = asked ?? kept;
    await notesAndRefusals(ctx, accepted, refused, n, who);
    if (moved) {
        return;
    }
    if (result?.branches) {
        await parkBranches(ctx, n, result.branches);
    } else if (stubHarness(result)) {
        await parkStub(ctx, n);
    } else if (costsNoTry(result)) {
        if (loggedOut(result)) {
            markPersona(ctx, record.session.persona ?? personaFor(stage));
        } else {
            record.interrupted = interruption(ctx, record.session, result);
        }
        ctx.log(`${who}: usage ${result?.usage.status}; no try, stays at ${record.stage}`);
    } else if (wait !== null) {
        record.waiting = true;
        ctx.log(`${who}: waiting for a person at ${record.stage}: ${wait}`);
        await ctx.digest.add({issue: n, text: `waits for a person: ${wait}`}).catch(error => {
            ctx.log(`${who}: digest note failed: ${String(error)}`);
        });
    } else if (rerun) {
        ctx.log(`${who}: CI rerun requested; no try, stays at ${record.stage}`);
    } else if (unverified || !(await movedByHand(ctx, n))) {
        const kept = keepLeftover(ctx.state, n, {stage, outbox, patches: listPatches(outbox)});
        if (kept > 0) {
            ctx.log(`${who}: ${kept} patch(es) kept for the next try`);
        }
        await countTry(ctx, n, outbox);
    }
}

/**
 * Judge an issue's ended session once, comment its usage and free its slot. The session
 * is marked judged (and saved) first, so a loop that dies half way never applies its
 * requests twice, and the verdict is saved as soon as it is reached.
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
        // Read before judging: a session that moved nothing counts a try.
        const attempt = session.try ?? record.tries + 1;
        try {
            await judgeIssue(ctx, n, outcome);
        } catch (error) {
            ctx.log(`#${n}: finishing failed: ${String(error)}`);
        }
        await postUsage(ctx, n, session, {stage: session.stage, try: attempt, outcome});
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
 * spawned session may not spawn again. A session whose login died marks its persona
 * logged out. One that names an issue comments its usage there.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {{container: string, started: string, outbox: string, persona: string, issue?: number | null, harness?: string, model?: string, judged?: boolean}} session - The session.
 * @param {Outcome} [outcome] - How the session ended.
 * @returns {Promise<void>}
 */
export async function finishSpawn(ctx, session, outcome = "exited") {
    const who = `spawn ${session.persona}`;
    if (!session.judged) {
        session.judged = true;
        ctx.save();
        try {
            const harness = session.harness ?? ctx.settings.harnessFor("qa");
            const result = takeResult(ctx, session.outbox, who, harness);
            if (loggedOut(result)) {
                markPersona(ctx, session.persona);
            }
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
        if (session.issue) {
            await postUsage(ctx, session.issue, session, {stage: "spawn", try: null, outcome});
        }
    }
    await ctx.sandbox.remove(session.container).catch(() => {});
    ctx.state.run.sessions = ctx.state.run.sessions.filter((/** @type {any} */ s) => s !== session);
    ctx.summary.spawns++;
}
