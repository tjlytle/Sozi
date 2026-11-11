/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Which issues the factory loop can start now, which issues a run covers, and whether
// the run has anything left to do.

import {promptFor} from "./state.js";

/**
 * @typedef {import("./state.js").State} State
 * @typedef {import("./state.js").IssueRecord} IssueRecord
 */

/** Tells whether every blocker of an issue is known and closed.
 *
 * @param {State} state - The state.
 * @param {IssueRecord} record - The issue.
 * @returns {boolean} - True when no blocker is open or unknown.
 */
function blockersClosed(state, record) {
    return record.blockers.every(n => state.issues[n]?.closed === true);
}

/** Tells whether a session can start for an issue now: not closed, running, waiting for
 * a person or labelled working by someone else.
 *
 * @param {State} state - The state.
 * @param {IssueRecord} r - The issue.
 * @returns {boolean} - True when the issue is startable.
 */
function isStartable(state, r) {
    if (r.closed || r.session || r.waiting || r.labels.includes("working")) {
        return false;
    }
    const startable =
        promptFor(r.stage) !== null || (r.stage === "stage:blocked" && r.blockers.length > 0);
    return startable && blockersClosed(state, r);
}

/** Lists the issues a session can start for now, by number. A blocked issue whose
 * blockers are all closed counts; the pass moves it on before starting it.
 *
 * @param {State} state - The state.
 * @param {object} _settings - The settings (unused so far).
 * @param {Date} _now - The current time (unused so far).
 * @returns {number[]} - The issue numbers.
 */
export function dueIssues(state, _settings, _now) {
    return Object.entries(state.issues)
        .filter(([, r]) => isStartable(state, r))
        .map(([n]) => Number(n))
        .sort((a, b) => a - b);
}

/** Selects the issues a run covers.
 *
 * @param {State} state - The state.
 * @param {object} options - The selection.
 * @param {number | null} [options.epic] - Only issues of this epic; every staged issue when absent.
 * @returns {number[]} - The issue numbers, ascending.
 */
export function scope(state, {epic} = {}) {
    return Object.entries(state.issues)
        .filter(([, r]) => (epic ? r.epic === epic : r.stage !== null))
        .map(([n]) => Number(n))
        .sort((a, b) => a - b);
}

/** Tells whether an issue can make no progress on its own: closed, done, parked, waiting
 * for a person, in triage or an idea, or blocked by issues none of which can make
 * progress (closed, outside the scope, or themselves quiet). A blocked issue with no
 * blockers is quiet. A blocker already being looked at (a cycle) counts as quiet.
 *
 * @param {State} state - The state.
 * @param {number} n - The issue number.
 * @param {number[]} scopeNumbers - The issues in scope.
 * @param {Set<number>} visited - The issues already on the path.
 * @returns {boolean} - True when the issue is quiet.
 */
function quietIssue(state, n, scopeNumbers, visited) {
    const r = state.issues[n];
    if (!r) {
        return true;
    }
    if (r.session || isStartable(state, r)) {
        return false;
    }
    if (r.closed || r.waiting || r.stage === "stage:done" || r.stage === "stage:parked") {
        return true;
    }
    if (r.stage === null) {
        return r.labels.includes("triage") || r.labels.includes("idea");
    }
    if (r.stage !== "stage:blocked") {
        return false;
    }
    visited.add(n);
    return r.blockers.every(b => {
        const blocker = state.issues[b];
        if (!scopeNumbers.includes(b) || !blocker || blocker.closed || visited.has(b)) {
            return true;
        }
        // A merged blocker that is not closed yet closes at the next sync: progress.
        return blocker.stage !== "stage:done" && quietIssue(state, b, scopeNumbers, visited);
    });
}

/** Tells whether nothing in the scope needs doing and nothing runs. An issue waiting for
 * a person is quiet, and so is one blocked by issues that cannot make progress.
 *
 * @param {State} state - The state.
 * @param {number[]} scopeNumbers - The issues in scope.
 * @returns {boolean} - True when the scope is quiet; an empty scope is.
 */
export function isQuiet(state, scopeNumbers) {
    return scopeNumbers.every(n => quietIssue(state, n, scopeNumbers, new Set()));
}
