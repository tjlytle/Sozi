/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The factory loop's state file: what the loop knows about each issue, the run
// totals, and the label changes waiting to be written to GitHub.

import fs from "node:fs";
import path from "node:path";

const STAGES = [
    "stage:todo",
    "stage:blocked",
    "stage:tests",
    "stage:in-progress",
    "stage:review",
    "stage:qa",
    "stage:done",
    "stage:parked"
];

const PROMPTS = {
    "stage:todo": "plan",
    "stage:tests": "tests",
    "stage:in-progress": "build",
    "stage:review": "review",
    "stage:qa": "qa"
};

const DEFAULT_MAX_TRIES = 3;

/**
 * @typedef {object} IssueRecord
 * @property {string} title - The issue title.
 * @property {string[]} labels - All labels on the issue.
 * @property {string | null} stage - The stage label, if any.
 * @property {string | null} [parkedFrom] - The stage the issue was parked from.
 * @property {string | null} [parkedAt] - When the loop parked the issue; null when a person did.
 * @property {boolean} closed - Whether the issue is closed on GitHub.
 * @property {number} tries - Sessions started at the current stage without success.
 * @property {object | null} session - The running session, if any.
 * @property {number[]} blockers - Issue numbers this issue waits for.
 * @property {number | null} epic - The epic this issue belongs to, if any.
 * @property {object | null} board - The board card, if any.
 * @property {number | null} [linked] - The epic the loop last linked the issue to as a sub-issue; absent until the loop has read its parent.
 * @property {string | null} seen - The issue's updatedAt when last read.
 * @property {boolean} [waiting] - A session ended asking a person to act; cleared by a stage change.
 */

/**
 * @typedef {object} LabelOp
 * @property {number} issue - The issue number.
 * @property {string[]} add - Labels to add.
 * @property {string[]} remove - Labels to remove.
 */

/**
 * @typedef {object} State
 * @property {Record<string, any>} run - Totals and flags of the current run.
 * @property {Record<number, IssueRecord>} issues - Known issues by number.
 * @property {{last: string | null, backoffUntil: string | null, backoffStreak?: number}} sync - GitHub sync bookkeeping; the streak counts model rate limits in a row.
 * @property {(LabelOp | {comment: {persona: string, issue: number, body: string}})[]} queued - Label changes and comments not yet written to GitHub.
 * @property {{op: object, error: string}[]} [deadLetters] - Queued writes GitHub refused for good.
 * @property {any} [boardMeta] - The board details bin/board.js caches.
 */

/** Creates a state with no issues.
 *
 * @returns {State} - The empty state.
 */
export function emptyState() {
    return {
        run: {
            started: null,
            until: null,
            epic: null,
            tokens: 0,
            costUsd: 0,
            stopped: false,
            notionPage: null,
            mintKey: null
        },
        issues: {},
        sync: {last: null, backoffUntil: null, backoffStreak: 0},
        queued: []
    };
}

/** Reads the state file, or returns an empty state when it does not exist.
 *
 * @param {string} file - The path.
 * @returns {State} - The state.
 */
export function loadState(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        if (/** @type {{code?: string}} */ (error).code === "ENOENT") {
            return emptyState();
        }
        throw error;
    }
}

/** Writes the state file atomically: a temporary file, then a rename. Only the owner may
 * read it, since it holds the run's mint key.
 *
 * @param {string} file - The path.
 * @param {State} state - The state.
 * @returns {void}
 */
export function saveState(file, state) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", {mode: 0o600});
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
}

/** Finds the stage among an issue's labels; of two, the later in the stage order.
 *
 * @param {string[]} labels - The labels.
 * @returns {string | null} - The stage label, or null when there is none.
 */
export function stageOf(labels) {
    return [...STAGES].reverse().find(stage => labels.includes(stage)) ?? null;
}

/** Names the prompt that runs a stage.
 *
 * @param {string | null} stage - The stage label.
 * @returns {string | null} - The prompt name, or null when the stage has no session.
 */
export function promptFor(stage) {
    return stage === null ? null : (PROMPTS[/** @type {keyof typeof PROMPTS} */ (stage)] ?? null);
}

/** Adds or refreshes an issue from its GitHub data. An issue waiting for a person keeps
 * waiting while its stage holds and it stays open; a parked one keeps its park time; the
 * board card and the sub-issue link carry over.
 *
 * @param {State} state - The state.
 * @param {object} issue - The issue.
 * @param {number} issue.number - The issue number.
 * @param {string} issue.title - The title.
 * @param {string[]} issue.labels - The label names.
 * @param {"OPEN" | "CLOSED"} issue.state - Whether the issue is open.
 * @param {string} [issue.body] - The body, searched for a "Part of #n" line.
 * @param {string} [issue.updatedAt] - When GitHub last changed the issue.
 * @param {number[]} [issue.blockedBy] - Blockers read from the plan comment; kept as they were when absent.
 * @returns {void}
 */
export function applyIssue(state, issue) {
    const existing = state.issues[issue.number];
    const epic = /^Part of #(\d+)\b/m.exec(issue.body ?? "");
    state.issues[issue.number] = {
        title: issue.title,
        labels: [...issue.labels],
        stage: stageOf(issue.labels),
        parkedFrom: existing?.parkedFrom ?? null,
        parkedAt: stageOf(issue.labels) === "stage:parked" ? (existing?.parkedAt ?? null) : null,
        closed: issue.state === "CLOSED",
        tries: existing && existing.stage === stageOf(issue.labels) ? existing.tries : 0,
        session: existing?.session ?? null,
        blockers: issue.blockedBy ?? existing?.blockers ?? [],
        epic: epic ? Number(epic[1]) : null,
        board: existing?.board ?? null,
        ...(existing?.linked !== undefined && {linked: existing.linked}),
        seen: issue.updatedAt ?? null,
        waiting:
            issue.state !== "CLOSED" && existing?.stage === stageOf(issue.labels)
                ? (existing?.waiting ?? false)
                : false
    };
}

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

/** Counts a session try for an issue.
 *
 * @param {State} state - The state.
 * @param {number} n - The issue number.
 * @param {number} [maxTries] - The tries after which the issue parks.
 * @returns {{tries: number, park: boolean}} - The new count and whether to park.
 */
export function recordTry(state, n, maxTries = DEFAULT_MAX_TRIES) {
    const record = state.issues[n];
    record.tries += 1;
    return {tries: record.tries, park: record.tries >= maxTries};
}

/** Sets an issue's stage: the stage field, the stage label, a fresh count of tries, and
 * no person awaited.
 *
 * @param {State} state - The state.
 * @param {number} n - The issue number.
 * @param {string} stage - The new stage label.
 * @returns {void}
 */
export function setStage(state, n, stage) {
    const record = state.issues[n];
    record.labels = [...record.labels.filter(l => !STAGES.includes(l)), stage];
    record.stage = stage;
    record.tries = 0;
    record.waiting = false;
}

/** Parks an issue, remembering the stage it came from.
 *
 * @param {State} state - The state.
 * @param {number} n - The issue number.
 * @returns {void}
 */
export function park(state, n) {
    const record = state.issues[n];
    if (record.stage !== "stage:parked") {
        record.parkedFrom = record.stage;
    }
    setStage(state, n, "stage:parked");
}

/** Wakes a parked issue at the stage it parked from, with its tries reset and no park time.
 *
 * @param {State} state - The state.
 * @param {number} n - The issue number.
 * @returns {string} - The restored stage.
 */
export function wake(state, n) {
    const record = state.issues[n];
    const stage = record.parkedFrom ?? "stage:todo";
    record.parkedFrom = null;
    record.parkedAt = null;
    setStage(state, n, stage);
    return stage;
}

/** Queues a label change to be written to GitHub.
 *
 * @param {State} state - The state.
 * @param {object} op - The change.
 * @param {number} op.issue - The issue number.
 * @param {string[]} [op.add] - Labels to add.
 * @param {string[]} [op.remove] - Labels to remove.
 * @returns {void}
 */
export function queueLabel(state, {issue, add = [], remove = []}) {
    state.queued.push({issue, add, remove});
}

/** Empties the label queue and returns what was in it.
 *
 * @param {State} state - The state.
 * @returns {State["queued"]} - The queued changes, oldest first.
 */
export function takeQueuedLabels(state) {
    return state.queued.splice(0);
}

/** Adds the usage of a session to the run totals.
 *
 * @param {State} state - The state.
 * @param {object} usage - The usage.
 * @param {number} usage.tokens - Tokens used.
 * @param {number} usage.costUsd - Cost in US dollars.
 * @returns {void}
 */
export function addUsage(state, {tokens, costUsd}) {
    state.run.tokens += tokens;
    state.run.costUsd += costUsd;
}

/** Compares the run's tokens with the configured ceilings; a ceiling of 0 is off.
 *
 * @param {State} state - The state.
 * @param {{softTokens: number, hardTokens: number}} settings - The settings.
 * @returns {"ok" | "soft" | "hard"} - Which ceiling is reached.
 */
export function ceiling(state, settings) {
    if (settings.hardTokens > 0 && state.run.tokens >= settings.hardTokens) {
        return "hard";
    }
    if (settings.softTokens > 0 && state.run.tokens >= settings.softTokens) {
        return "soft";
    }
    return "ok";
}
