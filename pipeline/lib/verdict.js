/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What an ended session's result allows: its usage (and the back-off a rate limit
// brings), whether its requests can be trusted, and which moves its stage may make.

import {readResult} from "./outbox.js";
import {addUsage} from "./state.js";

const MAX_BACKOFF_MINUTES = 120;

/** Usage reports after which a session that moved nothing costs no try. */
const NO_TRY_STATUSES = ["rate-limited", "unsupported"];

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
 * model was rate limited, or the harness cannot report usage.
 *
 * @param {Result | null} result - The result, if any.
 * @returns {boolean} True when the session costs no try.
 */
export function costsNoTry(result) {
    return result !== null && NO_TRY_STATUSES.includes(result.usage.status);
}

/**
 * Read a session's result and add its usage to the run. A rate-limited session backs the
 * loop off; each one in a row doubles the back-off, up to two hours.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} outbox - The outbox directory.
 * @param {string} who - The session, for the log.
 * @returns {Result | null} The result, or null when there is none.
 */
export function takeResult(ctx, outbox, who) {
    const result = readResult(outbox, {log: line => ctx.log(`${who}: ${line}`)});
    if (!result) {
        ctx.log(`${who}: no result.json`);
        return null;
    }
    addUsage(ctx.state, {
        tokens: result.usage.tokensIn + result.usage.tokensOut,
        costUsd: result.usage.costUsd
    });
    const sync = ctx.state.sync;
    if (result.usage.status !== "rate-limited") {
        sync.backoffStreak = 0;
        return result;
    }
    sync.backoffStreak = (sync.backoffStreak ?? 0) + 1;
    const minutes = Math.min(
        ctx.settings.rateLimitBackoffMinutes * 2 ** (sync.backoffStreak - 1),
        MAX_BACKOFF_MINUTES
    );
    const until = new Date(ctx.clock.now() + minutes * 60 * 1000).toISOString();
    sync.backoffUntil = until;
    ctx.state.run.startsPausedUntil = until;
    ctx.log(`${who}: the model is rate limited; no starts until ${until}`);
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
