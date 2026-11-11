/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The comment ops posts on an issue when a session ends: a one-line summary, and the
// session's usage folded away in a table, so the harnesses can be compared later.

const UNKNOWN = "unknown";

/** What the Result row adds for a session the loop did not see end on its own. */
const OUTCOME_NOTES = {
    exited: "",
    overdue: " · stopped at the wall-clock cap",
    gone: " · container gone"
};

/**
 * @typedef {object} UsageFields
 * @property {string} stage - The prompt stage the session ran, or "spawn".
 * @property {number | null} try - Which try at the stage it was, or null for a spawn.
 * @property {string} persona - The persona it ran as.
 * @property {string} harness - The harness it ran on.
 * @property {string} model - The model it ran.
 * @property {import("./outbox.js").Result | null} result - Its result, if any.
 * @property {string} startedAt - When it started, as an ISO time.
 * @property {string} endedAt - When it was judged, as an ISO time.
 * @property {import("./verdict.js").Outcome} outcome - How it ended.
 * @property {string} outbox - Its outbox directory.
 */

/**
 * Format a token count: as is under a thousand, in thousands under a million, in
 * millions with one decimal past it.
 *
 * @param {number} n - The count.
 * @returns {string} The count, short.
 */
export function formatTokens(n) {
    if (n < 1000) {
        return String(n);
    }
    const thousands = Math.round(n / 1000);
    return thousands < 1000 ? `${thousands}k` : `${(n / 1e6).toFixed(1)}M`;
}

/**
 * Format a wall time: minutes in the summary, minutes and seconds in the table, hours
 * and minutes past an hour, seconds under a minute.
 *
 * @param {number} seconds - The wall time in seconds.
 * @param {"summary" | "table"} where - Where it shows.
 * @returns {string} The wall time.
 */
export function formatDuration(seconds, where) {
    const s = Math.max(0, Math.round(seconds));
    const pad = (/** @type {number} */ v) => String(v).padStart(2, "0");
    if (s >= 3600) {
        return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
    }
    if (s < 60) {
        return `${s}s`;
    }
    const minutes = `${Math.floor(s / 60)}m`;
    return where === "summary" ? minutes : `${minutes} ${pad(s % 60)}s`;
}

/**
 * Format the turns, with the resumes in brackets when there were any.
 *
 * @param {number} turns - The turns.
 * @param {number} resumes - The resumes.
 * @returns {string} The turns.
 */
export function formatTurns(turns, resumes) {
    if (resumes === 0) {
        return String(turns);
    }
    return `${turns} (${resumes} ${resumes === 1 ? "resume" : "resumes"})`;
}

/**
 * Build the usage comment of an ended session. With no result, or a result whose
 * harness wrote no usage.json, the counts and the status are unknown.
 *
 * @param {UsageFields} fields - The session.
 * @returns {string} The comment, in markdown.
 */
export function usageComment(fields) {
    const {stage, persona, harness, model, result, outcome} = fields;
    const usage = result?.usageKnown ? result.usage : null;
    const label = stage === "spawn" ? `spawn (${persona})` : stage;
    const seconds = (Date.parse(fields.endedAt) - Date.parse(fields.startedAt)) / 1000;
    const total = usage
        ? formatTokens(usage.tokensIn + usage.cacheRead + usage.cacheWrite + usage.tokensOut)
        : UNKNOWN;
    const turns = usage ? formatTurns(usage.turns, result?.resumes ?? 0) : UNKNOWN;
    const count = (/** @type {number} */ n) => n.toLocaleString("en-US");
    const summary = [
        `⏱ ${label}`,
        `${harness} ${model}`,
        `${total} tokens`,
        `${usage ? usage.turns : UNKNOWN} turns`,
        formatDuration(seconds, "summary"),
        usage?.status ?? UNKNOWN
    ].join(" · ");
    const rows = [
        ["Stage", fields.try === null ? label : `${label} (try ${fields.try})`],
        ["Harness / model", `${harness} / ${model}`],
        [
            "Tokens",
            usage
                ? `in ${count(usage.tokensIn)} · cache read ${count(usage.cacheRead)} · ` +
                  `cache write ${count(usage.cacheWrite)} · out ${count(usage.tokensOut)}`
                : UNKNOWN
        ],
        ["Turns", turns],
        ["Wall time", formatDuration(seconds, "table")],
        ["Cost (notional)", usage ? `$${usage.costUsd.toFixed(2)}` : UNKNOWN],
        [
            "Result",
            (result
                ? `${usage?.status ?? UNKNOWN} · exit ${result.exit} · hooks ${result.hooks}`
                : UNKNOWN) + OUTCOME_NOTES[outcome]
        ],
        ["Outbox", fields.outbox.split("/").pop()]
    ];
    return [
        "<details>",
        `<summary>${summary}</summary>`,
        "",
        "| | |",
        "|---|---|",
        ...rows.map(([name, value]) => `| ${name} | ${value} |`),
        "</details>"
    ].join("\n");
}
