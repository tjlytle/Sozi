/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The personas whose login died this run: a session that reported a failed login marks
// its persona, and the mark lifts once that persona's credentials change after it.

/**
 * @typedef {{since: string}} LoggedOut
 */

/**
 * Mark a persona logged out; a persona already marked keeps the time of its first mark.
 *
 * @param {any} state - The loop state; gets run.loggedOut.
 * @param {string} persona - The persona.
 * @param {string} now - The time of the mark, an ISO date.
 * @returns {boolean} True when the persona was not marked before.
 */
export function markLoggedOut(state, persona, now) {
    state.run.loggedOut ??= {};
    if (state.run.loggedOut[persona]) {
        return false;
    }
    state.run.loggedOut[persona] = {since: now};
    return true;
}

/**
 * Tell whether a persona is still logged out, and drop its mark when its credentials
 * changed after it.
 *
 * @param {any} state - The loop state.
 * @param {string} persona - The persona.
 * @param {string | null} updated - When the persona's credentials last changed, if known.
 * @returns {boolean} True while the mark holds.
 */
export function stillLoggedOut(state, persona, updated) {
    /** @type {LoggedOut | undefined} */
    const mark = state.run.loggedOut?.[persona];
    if (!mark) {
        return false;
    }
    if (updated !== null && Date.parse(updated) > Date.parse(mark.since)) {
        delete state.run.loggedOut[persona];
        return false;
    }
    return true;
}

/**
 * The line that says a persona is logged out and how to log it back in.
 *
 * @param {string} persona - The persona.
 * @returns {string} The line.
 */
export function loggedOutLine(persona) {
    return `${persona}: logged out; run npm run pipeline -- --login ${persona}`;
}

/**
 * One line per logged-out persona, for the log and --status.
 *
 * @param {any} state - The loop state.
 * @returns {string[]} The lines.
 */
export function loggedOutLines(state) {
    return Object.keys(state.run.loggedOut ?? {}).map(loggedOutLine);
}
