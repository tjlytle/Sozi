/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Carrying a stage over a usage limit: what the next session of the stage takes over from the
// one the limit stopped, and the comment that says a fallback harness took the stage.

/**
 * @typedef {import("./state.js").Interrupted} Interrupted
 * @typedef {import("./stage-route.js").StageRoute} StageRoute
 */

/**
 * What a stage's new session takes over from one a usage limit stopped: the carried work when
 * the interrupted session ran this stage, and the session to resume when it also ran on this
 * harness as this persona with a profile. Nothing for an interruption from another stage.
 *
 * @param {Interrupted | null | undefined} gone - The interrupted session, if any.
 * @param {string} stage - The prompt stage starting.
 * @param {{persona: string, profile: boolean, route: StageRoute}} who - Who starts it, and where.
 * @returns {{carryFrom?: string, resume?: {session: string, carryFrom: string}}} - The carry.
 */
export function carryOf(gone, stage, {persona, profile, route}) {
    if (!gone || gone.stage !== stage) {
        return {};
    }
    const same = gone.harness === route.harness && gone.persona === persona && profile;
    if (same && gone.session) {
        return {carryFrom: gone.outbox, resume: {session: gone.session, carryFrom: gone.outbox}};
    }
    return {carryFrom: gone.outbox};
}

/**
 * The ops comment that says a stage runs on a fallback harness, and until when the harness it
 * would have run on is at its usage limit: the UTC clock time, with the date when not today.
 *
 * @param {object} fallback - The fallback.
 * @param {string} fallback.stage - The prompt stage.
 * @param {StageRoute} fallback.route - The harness and model it runs on.
 * @param {string} fallback.from - The harness at its limit.
 * @param {string} fallback.until - When that harness's pause ends.
 * @param {number} fallback.now - The current time, in epoch milliseconds.
 * @returns {string} - The comment.
 */
export function fallbackNote({stage, route, from, until, now}) {
    const day = until.slice(0, 10);
    const today = day === new Date(now).toISOString().slice(0, 10);
    const at = `${today ? "" : `${day} `}${until.slice(11, 16)} UTC`;
    return (
        `Pipeline: ${stage} runs on ${route.harness} ${route.model}, not ${from}: ${from} is at ` +
        `its usage limit until ${at} (\`PIPELINE_ON_LIMIT=fallback\`).`
    );
}
