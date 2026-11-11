/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Usage limits per harness: a harness that stopped at its limit is paused until its reset, and
// the stages due on it wait or run on a fallback. Pure functions over run.limits.

const MINUTE = 60 * 1000;
const MAX_BACKOFF_MINUTES = 120;

/**
 * @typedef {object} Pause
 * @property {string} until - When the harness may start sessions again.
 * @property {number} streak - Usage limits in a row on the harness.
 * @property {boolean} reported - Whether the CLI named the reset, rather than the back-off.
 * @typedef {Record<string, Pause>} Limits
 * @typedef {{harness: string, model: string}} Route
 */

/**
 * The pause a usage limit brings: until the reset the CLI named, else the back-off, doubled for
 * each limit in a row on the harness, up to two hours.
 *
 * @param {Limits | undefined} limits - The pauses so far.
 * @param {string} harness - The harness that stopped.
 * @param {{resetAt: Date | null, backoffMinutes: number, now: number}} options - The reset
 *     named, if any, the first back-off in minutes, and the current time in epoch milliseconds.
 * @returns {Pause} - The harness's new pause.
 */
export function pauseHarness(limits, harness, {resetAt, backoffMinutes, now}) {
    const streak = (limits?.[harness]?.streak ?? 0) + 1;
    if (resetAt) {
        return {until: resetAt.toISOString(), streak, reported: true};
    }
    const minutes = Math.min(backoffMinutes * 2 ** (streak - 1), MAX_BACKOFF_MINUTES);
    return {until: new Date(now + minutes * MINUTE).toISOString(), streak, reported: false};
}

/**
 * The pauses without a harness's, once a session on it ended ok.
 *
 * @param {Limits | undefined} limits - The pauses.
 * @param {string} harness - The harness.
 * @returns {Limits} - A new record without it.
 */
export function clearHarness(limits, harness) {
    const rest = {...limits};
    delete rest[harness];
    return rest;
}

/**
 * When a harness may start sessions again.
 *
 * @param {Limits | undefined} limits - The pauses.
 * @param {string} harness - The harness.
 * @param {number} now - The current time, in epoch milliseconds.
 * @returns {string | null} - The end of its pause, or null when it is not paused.
 */
export function pausedUntil(limits, harness, now) {
    const until = limits?.[harness]?.until;
    return until && now < Date.parse(until) ? until : null;
}

/**
 * Where a stage runs: its own route when the harness is not paused; under the fallback policy,
 * the first fallback that is not paused itself; otherwise it waits for the reset. The caller
 * checks the persona's login to a fallback, and asks again without one it is not logged in to.
 *
 * @param {object} options - The choice.
 * @param {Route} options.route - The harness and model the stage would run on.
 * @param {Route[]} options.fallbacks - The fallbacks of the route's harness, in order.
 * @param {string} options.policy - PIPELINE_ON_LIMIT: wait or fallback.
 * @param {Limits | undefined} options.limits - The pauses.
 * @param {number} options.now - The current time, in epoch milliseconds.
 * @returns {Route | (Route & {fallbackFrom: string}) | {wait: string}} - The route to start,
 *     or when the stage may start again.
 */
export function chooseHarness({route, fallbacks, policy, limits, now}) {
    const until = pausedUntil(limits, route.harness, now);
    if (!until) {
        return route;
    }
    if (policy === "fallback") {
        const free = fallbacks.find(f => !pausedUntil(limits, f.harness, now));
        if (free) {
            return {harness: free.harness, model: free.model, fallbackFrom: route.harness};
        }
    }
    return {wait: until};
}
