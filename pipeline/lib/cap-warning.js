/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The cap warning: a running issue session is told once, PIPELINE_SESSION_WARN_MINUTES
// before PIPELINE_SESSION_MINUTES stops it, to commit and push what it has. The warning is
// nudge-cap.md in its outbox, which pipeline/nudge.sh prints to the agent.

import {writeNew} from "./outbox.js";

const MINUTE_MS = 60 * 1000;

/**
 * @typedef {object} CapSession
 * @property {string} outbox - The session's outbox.
 * @property {string} started - When it started.
 * @property {boolean} [judged] - Set once the session ended.
 * @property {boolean} [warned] - Whether the cap warning was written.
 */

/**
 * The warning a session gets before the cap.
 *
 * @param {number} minutesLeft - The minutes before the session is stopped.
 * @returns {string} The warning, one line.
 */
export function warnText(minutesLeft) {
    return (
        `The runner: this session is stopped in about ${Math.round(minutesLeft)} minutes ` +
        "(PIPELINE_SESSION_MINUTES). Commit and push what you have now; a work-in-progress " +
        "commit is fine, say so in the PR body."
    );
}

/**
 * The running issue sessions still to be warned, by issue. None when either setting is 0.
 *
 * @param {import("./state.js").State} state - The loop state.
 * @param {{sessionMinutes: number, sessionWarnMinutes: number}} settings - The settings.
 * @returns {[number, CapSession][]} The issues and their sessions.
 */
function unwarned(state, {sessionMinutes, sessionWarnMinutes}) {
    if (sessionMinutes <= 0 || sessionWarnMinutes <= 0) {
        return [];
    }
    /** @type {[number, CapSession][]} */
    const sessions = [];
    for (const [key, record] of Object.entries(state.issues)) {
        const session = /** @type {CapSession | null} */ (record.session);
        if (session && !session.judged && !session.warned) {
            sessions.push([Number(key), session]);
        }
    }
    return sessions;
}

/**
 * When a session is due its warning, in epoch milliseconds.
 *
 * @param {CapSession} session - The session.
 * @param {{sessionMinutes: number, sessionWarnMinutes: number}} settings - The settings.
 * @returns {number} The time.
 */
function dueAt(session, {sessionMinutes, sessionWarnMinutes}) {
    return Date.parse(session.started) + (sessionMinutes - sessionWarnMinutes) * MINUTE_MS;
}

/**
 * Warn each running issue session that has reached its warning time, once.
 *
 * @param {import("./sync.js").PassContext} ctx - The pass context.
 * @returns {void}
 */
export function warnSessions(ctx) {
    const now = ctx.clock.now();
    for (const [issue, session] of unwarned(ctx.state, ctx.settings)) {
        if (now < dueAt(session, ctx.settings)) {
            continue;
        }
        const capAt = Date.parse(session.started) + ctx.settings.sessionMinutes * MINUTE_MS;
        const left = Math.max(0, (capAt - now) / MINUTE_MS);
        session.warned = true;
        writeNew(session.outbox, "nudge-cap.md", warnText(left) + "\n");
        ctx.log(`#${issue}: warned ${Math.round(left)} minutes before the cap`);
    }
}

/**
 * The seconds until the earliest warning not yet written, so the loop can wake for it.
 *
 * @param {import("./state.js").State} state - The loop state.
 * @param {{sessionMinutes: number, sessionWarnMinutes: number}} settings - The settings.
 * @param {number} now - The time, in epoch milliseconds.
 * @returns {number | null} The seconds, at least 0, or null when no warning is left.
 */
export function secondsToNextWarning(state, settings, now) {
    const times = unwarned(state, settings).map(([, session]) => dueAt(session, settings));
    if (times.length === 0) {
        return null;
    }
    return Math.max(0, Math.ceil((Math.min(...times) - now) / 1000));
}
