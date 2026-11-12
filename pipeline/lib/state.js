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
 * @typedef {object} Session
 * @property {string} container - The container id.
 * @property {string} started - When it started.
 * @property {string} stage - The prompt stage name.
 * @property {string} outbox - The outbox directory.
 * @property {string} [persona] - The persona; absent on sessions saved before personas.
 * @property {string} [harness] - The harness it runs on; absent on sessions saved before harnesses.
 * @property {string} [model] - The model it runs on; absent with the harness.
 * @property {boolean} [planned] - Whether the plan's Harness line chose the harness, not the stage setting.
 * @property {boolean} [profile] - Whether the persona's profile was mounted; absent on sessions saved before resumes.
 * @property {Interrupted | null} [carried] - The interrupted session whose work it carries, kept so that a carry that does not apply is not lost.
 */

/**
 * @typedef {object} IssueRecord
 * @property {string} title - The issue title.
 * @property {string[]} labels - All labels on the issue.
 * @property {string | null} stage - The stage label, if any.
 * @property {string | null} [stageSince] - When the issue entered its stage (ISO time); absent on records saved before it was kept.
 * @property {string | null} [parkedFrom] - The stage the issue was parked from.
 * @property {string | null} [parkedAt] - When the loop parked the issue; null when a person did.
 * @property {boolean} closed - Whether the issue is closed on GitHub.
 * @property {number} tries - Sessions started at the current stage without success.
 * @property {object | null} session - The running session, if any: a Session.
 * @property {number[]} blockers - Issue numbers this issue waits for.
 * @property {number | null} epic - The epic this issue belongs to, if any.
 * @property {object | null} board - The board card, if any.
 * @property {number | null} [linked] - The epic the loop last linked the issue to as a sub-issue; absent until the loop has read its parent.
 * @property {string | null} seen - The issue's updatedAt when last read.
 * @property {boolean} [waiting] - A session ended asking a person to act; cleared by a stage change.
 * @property {Interrupted | null} [interrupted] - The session a usage limit stopped, whose work the next session of its stage carries on; cleared when that one starts.
 */

/**
 * @typedef {object} Interrupted
 * @property {string} harness - The harness it ran on.
 * @property {string} model - The model it ran on.
 * @property {string | null} session - The harness session to resume; null when it ran without a profile, which keeps no transcript.
 * @property {string} outbox - Its outbox, which holds carry.bundle and carry.patch.
 * @property {string} persona - The persona it ran as.
 * @property {string} stage - The prompt stage it ran.
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
 * @property {{last: string | null, backoffUntil: string | null}} sync - GitHub sync bookkeeping.
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
            closing: null,
            notionPage: null,
            mintKey: null,
            limits: {},
            advisors: {}
        },
        issues: {},
        sync: {last: null, backoffUntil: null},
        queued: []
    };
}

/** Reads the state file, or returns an empty state when it does not exist. A state saved
 * before limits were kept per harness drops the run-wide pause and streak it had; one saved
 * before the advisor gets no advisor sessions.
 *
 * @param {string} file - The path.
 * @returns {State} - The state.
 */
export function loadState(file) {
    try {
        const state = JSON.parse(fs.readFileSync(file, "utf8"));
        delete state.run.startsPausedUntil;
        delete state.sync.backoffStreak;
        state.run.limits ??= {};
        state.run.advisors ??= {};
        return state;
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
 * board card, the sub-issue link and an interrupted session carry over. A new issue, or one
 * whose stage changed, entered its stage at its updatedAt; otherwise that time holds.
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
    const sameStage = existing !== undefined && existing.stage === stageOf(issue.labels);
    state.issues[issue.number] = {
        title: issue.title,
        labels: [...issue.labels],
        stage: stageOf(issue.labels),
        stageSince: sameStage ? (existing.stageSince ?? null) : (issue.updatedAt ?? null),
        parkedFrom: existing?.parkedFrom ?? null,
        parkedAt: stageOf(issue.labels) === "stage:parked" ? (existing?.parkedAt ?? null) : null,
        closed: issue.state === "CLOSED",
        tries: existing && existing.stage === stageOf(issue.labels) ? existing.tries : 0,
        session: existing?.session ?? null,
        blockers: issue.blockedBy ?? existing?.blockers ?? [],
        epic: epic ? Number(epic[1]) : null,
        board: existing?.board ?? null,
        ...(existing?.linked !== undefined && {linked: existing.linked}),
        ...(existing?.interrupted && {interrupted: existing.interrupted}),
        seen: issue.updatedAt ?? null,
        waiting:
            issue.state !== "CLOSED" && existing?.stage === stageOf(issue.labels)
                ? (existing?.waiting ?? false)
                : false
    };
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

/** Sets an issue's stage: the stage field, the stage label, when it entered the stage, a
 * fresh count of tries, and no person awaited.
 *
 * @param {State} state - The state.
 * @param {number} n - The issue number.
 * @param {string} stage - The new stage label.
 * @param {string} since - When the issue entered the stage (ISO time).
 * @returns {void}
 */
export function setStage(state, n, stage, since) {
    const record = state.issues[n];
    record.labels = [...record.labels.filter(l => !STAGES.includes(l)), stage];
    record.stage = stage;
    record.stageSince = since;
    record.tries = 0;
    record.waiting = false;
}

/** Parks an issue, remembering the stage it came from.
 *
 * @param {State} state - The state.
 * @param {number} n - The issue number.
 * @param {string} since - When the issue is parked (ISO time).
 * @returns {void}
 */
export function park(state, n, since) {
    const record = state.issues[n];
    if (record.stage !== "stage:parked") {
        record.parkedFrom = record.stage;
    }
    setStage(state, n, "stage:parked", since);
}

/** Wakes a parked issue at the stage it parked from, with its tries reset and no park time.
 *
 * @param {State} state - The state.
 * @param {number} n - The issue number.
 * @param {string} since - When the issue wakes (ISO time).
 * @returns {string} - The restored stage.
 */
export function wake(state, n, since) {
    const record = state.issues[n];
    const stage = record.parkedFrom ?? "stage:todo";
    record.parkedFrom = null;
    record.parkedAt = null;
    setStage(state, n, stage, since);
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
