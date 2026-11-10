/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What an ended session's result allows: its usage (and the back-off a rate limit
// brings), whether its requests can be trusted, and which moves its stage may make.

import {clearHarness, pauseHarness} from "./limits.js";
import {readResult} from "./outbox.js";
import {resetTime} from "./resets.js";
import {addUsage} from "./state.js";

/** The zone of the containers the CLIs run in, which a reset time with no zone is read in. */
const CONTAINER_ZONE = "UTC";

/** The moves each stage's session may ask for with a done request, by prompt name. */
const TRANSITIONS = {
    plan: ["stage:tests", "stage:blocked", "triage"],
    tests: ["stage:in-progress"],
    build: ["stage:review"],
    review: ["stage:qa", "stage:in-progress"],
    qa: ["stage:done", "stage:in-progress"]
};

/** Moves any stage's session may ask for. */
const ANY_STAGE = ["stage:parked", "triage"];

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 * @typedef {import("./requests.js").Result} Result
 * @typedef {"exited" | "gone" | "overdue"} Outcome
 */

/**
 * List the targets a done request from a stage's session may name.
 *
 * @param {string} stage - The prompt name the session ran: plan, tests, build, review or qa.
 * @returns {string[]} The allowed targets.
 */
export function allowedMoves(stage) {
    return [...(TRANSITIONS[/** @type {keyof typeof TRANSITIONS} */ (stage)] ?? []), ...ANY_STAGE];
}

/**
 * Tell whether a result excuses a session that moved nothing from counting as a try: the
 * model was rate limited, or the session's login had died.
 *
 * @param {Result | null} result - The result, if any.
 * @returns {boolean} True when the session costs no try.
 */
export function costsNoTry(result) {
    return result?.usage.status === "rate-limited" || loggedOut(result);
}

/**
 * Tell whether a result comes from a session whose login had died: it failed to
 * authenticate before any model call.
 *
 * @param {Result | null} result - The result, if any.
 * @returns {boolean} True when the harness reported auth.
 */
export function loggedOut(result) {
    return result?.usage.status === "auth";
}

/**
 * Tell whether a result comes from a stub harness: its adapter cannot run a session at
 * all, so another try never helps.
 *
 * @param {Result | null} result - The result, if any.
 * @returns {boolean} True when the harness reported unsupported.
 */
export function stubHarness(result) {
    return result?.usage.status === "unsupported";
}

/**
 * Read a session's result and add its usage to the run. A rate-limited session pauses its
 * harness until the reset its CLI named, else for the back-off (limits.js); a session that
 * ended ok clears its harness's pause. GitHub's back-off is not touched.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} outbox - The outbox directory.
 * @param {string} who - The session, for the log.
 * @param {string} harness - The harness the session ran on.
 * @returns {Result | null} The result, or null when there is none.
 */
export function takeResult(ctx, outbox, who, harness) {
    const result = readResult(outbox, {log: line => ctx.log(`${who}: ${line}`)});
    if (!result) {
        ctx.log(`${who}: no result.json`);
        return null;
    }
    addUsage(ctx.state, {
        tokens: result.usage.tokensIn + result.usage.tokensOut,
        costUsd: result.usage.costUsd
    });
    const run = ctx.state.run;
    if (result.usage.status === "ok") {
        run.limits = clearHarness(run.limits, harness);
    }
    if (result.usage.status !== "rate-limited") {
        return result;
    }
    const now = ctx.clock.now();
    const pause = pauseHarness(run.limits, harness, {
        resetAt: resetTime(result.usage.limit ?? "", new Date(now), CONTAINER_ZONE),
        backoffMinutes: ctx.settings.rateLimitBackoffMinutes,
        now
    });
    run.limits = {...run.limits, [harness]: pause};
    const why = pause.reported ? "reset reported" : `back-off, ${pause.streak} in a row`;
    ctx.log(
        `${who}: ${harness} is at its usage limit; no ${harness} starts until ${pause.until} (${why})`
    );
    return result;
}

/**
 * Why a session's requests cannot be trusted, if they cannot: the outside checks crashed
 * or did not run, there is no result, or the loop stopped the session at the wall-clock
 * cap.
 *
 * @param {Result | null} result - The result, if any.
 * @param {Outcome} outcome - How the session ended.
 * @returns {string | null} The reason, or null when the requests stand.
 */
export function unverifiedReason(result, outcome) {
    if (outcome === "overdue") {
        return "stopped at the wall-clock cap";
    }
    if (result === null) {
        return "no result";
    }
    if (result.hooks === "error") {
        return "the outside checks crashed";
    }
    return result.hooks === "skipped" ? "the outside checks did not run" : null;
}
