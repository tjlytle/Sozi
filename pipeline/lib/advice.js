/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The advisor's pure side: reading a stage's question (written by bin/advise inside the
// container, so untrusted), building the consult prompt, the record comment and the texts
// a stage reads, and deciding when an advisor session rolls over. No I/O here; the pass
// reads and writes the files (consults.js) and the Advisor runs the consults (advisor.js).

import {formatTokens} from "./usage-comment.js";

/** The largest question file read, in bytes: the question, the diff and the failing output. */
export const MAX_QUESTION_FILE_BYTES = 192 * 1024;
/** The longest question, in characters. */
export const MAX_QUESTION_CHARS = 8000;
/** The diff a consult carries, in bytes; bin/advise cuts it to the same. */
export const MAX_DIFF_BYTES = 100 * 1024;
/** The failing output a consult carries, in bytes; bin/advise cuts it to the same. */
export const MAX_FAILING_BYTES = 20 * 1024;

/** What an advisor session past its context cap is asked before a new one starts. */
export const SUMMARY_PROMPT =
    "This advisor session is about to be replaced by a fresh one. Summarise it for your " +
    "successor in at most 400 words: the epic, each question you were asked (issue, stage, " +
    "question) and what you advised, and anything you would tell the next advisor.";

/**
 * @typedef {object} Question
 * @property {string} question - What the stage asks, trimmed.
 * @property {string} stage - The stage the file names; the runner trusts its own record instead.
 * @property {string} diff - The diff so far, cut to MAX_DIFF_BYTES.
 * @property {string} failing - The failing output, cut to MAX_FAILING_BYTES.
 */

/**
 * @typedef {object} ConsultUsage
 * @property {number} tokensIn - Input tokens, cached input left out.
 * @property {number} cacheRead - Input tokens read from the cache.
 * @property {number} cacheWrite - Input tokens written to the cache.
 * @property {number} tokensOut - Output tokens.
 * @property {number} costUsd - Cost in US dollars.
 */

/**
 * @typedef {ConsultUsage & {model: string, consults: number}} AdvisorTotal
 */

/**
 * Cut a text to a number of bytes, with a note saying so.
 *
 * @param {string} text - The text.
 * @param {number} max - The most bytes kept.
 * @param {string} what - What the text is, for the note.
 * @returns {string} The text, or its start and the note.
 */
export function cut(text, max, what) {
    const bytes = Buffer.from(text);
    if (bytes.length <= max) {
        return text;
    }
    return `${bytes.subarray(0, max).toString()}\n[${what} cut to ${max / 1024} KiB]`;
}

/**
 * Read a question file's text and check it. The issue it names, when it names one, must be
 * the session's own; the diff and the failing output are cut again here, since the
 * container may not have.
 *
 * @param {string} text - The file's text.
 * @param {{issue: number}} session - The session the file came from.
 * @returns {Question} The question.
 * @throws {Error} When the file is not a valid question; the message says why.
 */
export function parseQuestion(text, {issue}) {
    let obj;
    try {
        obj = JSON.parse(text);
    } catch {
        throw new Error("question file is not JSON");
    }
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
        throw new Error("question must be an object");
    }
    if (typeof obj.question !== "string" || obj.question.trim() === "") {
        throw new Error("question must be a non-empty string");
    }
    const question = obj.question.trim();
    if (question.length > MAX_QUESTION_CHARS) {
        throw new Error(`question is longer than ${MAX_QUESTION_CHARS} characters`);
    }
    if (obj.issue !== undefined && Number(obj.issue) !== issue) {
        throw new Error(`question names issue #${obj.issue}, not #${issue}`);
    }
    for (const field of ["stage", "diff", "failing"]) {
        if (obj[field] !== undefined && typeof obj[field] !== "string") {
            throw new Error(`${field} must be a string`);
        }
    }
    return {
        question,
        stage: obj.stage ?? "",
        diff: cut(obj.diff ?? "", MAX_DIFF_BYTES, "diff"),
        failing: cut(obj.failing ?? "", MAX_FAILING_BYTES, "failing output")
    };
}

/**
 * Name the advisor session an issue consults: its epic's, or its own when it has none.
 *
 * @param {{issue: number, epic: number | null}} where - The issue and its epic.
 * @returns {string} The key in state.run.advisors.
 */
export function consultKey({issue, epic}) {
    return epic ? String(epic) : `issue-${issue}`;
}

/**
 * A fenced block that no line of the text can close.
 *
 * @param {string} text - The text.
 * @returns {string} The block, or a note when the text is empty.
 */
function fenced(text) {
    if (text.trim() === "") {
        return "(none)";
    }
    const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length));
    const fence = "`".repeat(longest + 1);
    return `${fence}\n${text.replace(/\n$/, "")}\n${fence}`;
}

/**
 * Build the text of one consult: who asks and why, the issue at hand, its plan, the epic
 * and its siblings when there is one, the question, the diff and the failing output. A
 * summary of the advisor session it replaces comes first.
 *
 * @param {object} parts - What the consult carries.
 * @param {{number: number, title: string, body: string}} parts.issue - The issue at hand.
 * @param {string | null} parts.plan - Its newest Implementation Plan comment.
 * @param {string} parts.stage - The stage asking.
 * @param {string} parts.question - The question.
 * @param {string} parts.diff - The diff so far.
 * @param {string} parts.failing - The failing output.
 * @param {{number: number, body: string, siblings: {number: number, title: string, stage: string | null}[]} | null} parts.epic - The epic, if any.
 * @param {string | null} [parts.summary] - The summary of the session this one replaces.
 * @returns {string} The prompt, in markdown.
 */
export function consultPrompt({issue, plan, stage, question, diff, failing, epic, summary}) {
    const parts = [
        "You are the advisor of a software factory: stage sessions (plan, tests, build, review, " +
            "qa) run on other models and ask you when they are stuck. Answer the question below " +
            "with concrete, short advice: what to try next and why. You cannot run anything; " +
            "everything you know is in this conversation.",
        ...(summary ? ["## Summary of the earlier advisor session", summary] : []),
        `## Stage asking: ${stage}`,
        `## Issue #${issue.number} ${issue.title}`,
        issue.body,
        "## Implementation Plan",
        plan ?? "(the issue has no Implementation Plan comment)"
    ];
    if (epic) {
        const siblings = epic.siblings.map(
            s => `- #${s.number} ${s.title} (${s.stage ?? "no stage"})`
        );
        parts.push(`## Epic #${epic.number}`, epic.body, "### Its issues", siblings.join("\n"));
    }
    parts.push("## Question", question, "## Diff so far", fenced(diff));
    parts.push("## Failing output", fenced(failing));
    return parts.join("\n\n") + "\n";
}

/**
 * Build the comment ops posts on the issue for a consult: the question and the advice,
 * folded away, with the advisor's model and tokens in the summary line.
 *
 * @param {{stage: string, question: string, advice: string, model: string, usage: ConsultUsage}} consult - The consult.
 * @returns {string} The comment, in markdown.
 */
export function recordComment({stage, question, advice, model, usage}) {
    const tokens = usage.tokensIn + usage.cacheRead + usage.cacheWrite + usage.tokensOut;
    const quoted = question
        .split("\n")
        .map(line => `> ${line}`)
        .join("\n");
    return [
        "<details>",
        `<summary>🧭 advisor · ${stage} · ${model} · ${formatTokens(tokens)} tokens</summary>`,
        "",
        "**Question**",
        "",
        quoted,
        "",
        "**Advice**",
        "",
        advice,
        "",
        "</details>"
    ].join("\n");
}

/**
 * Tell whether an advisor session has grown past the context cap.
 *
 * @param {{session: string, context: number} | null | undefined} entry - The session's record, if any.
 * @param {number} max - The cap in tokens; 0 is off.
 * @returns {boolean} True when the next consult starts a new session.
 */
export function rollsOver(entry, max) {
    return Boolean(entry) && max > 0 && /** @type {{context: number}} */ (entry).context >= max;
}

/**
 * Estimate an advisor session's context from one consult's usage: the input of a turn, on
 * average, since every turn reads the whole conversation.
 *
 * @param {{tokensIn: number, cacheRead: number, cacheWrite: number, tokensOut?: number, turns: number}} usage - The consult's usage.
 * @returns {number} The context, in tokens.
 */
export function contextOf(usage) {
    const input = usage.tokensIn + usage.cacheRead + usage.cacheWrite;
    return Math.round(input / Math.max(1, usage.turns));
}

/**
 * Find the advice in a Claude stream: the last result's text, or else the last text the
 * assistant wrote.
 *
 * @param {string} stream - The stream-json lines.
 * @returns {string | null} The advice, or null when there is none.
 */
export function answerText(stream) {
    let result = null;
    let said = null;
    for (const line of stream.split("\n")) {
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            continue;
        }
        if (event?.type === "result" && typeof event.result === "string" && event.result) {
            result = event.result;
        } else if (event?.type === "assistant" && Array.isArray(event.message?.content)) {
            const text = event.message.content
                .filter((/** @type {any} */ c) => c?.type === "text" && typeof c.text === "string")
                .map((/** @type {any} */ c) => c.text)
                .join("\n");
            said = text || said;
        }
    }
    return result ?? said;
}

/**
 * Say why a consult is refused once a session has used its consults.
 *
 * @param {number} max - The consults a session may make.
 * @returns {string} The refusal.
 */
export function refusal(max) {
    return `advisor limit reached: ${max} consults a session (PIPELINE_ADVISOR_MAX)`;
}

/**
 * The nudge a session gets once it has used its share of the time.
 *
 * @param {number} minutes - The minutes it has run.
 * @returns {string} The nudge, one line.
 */
export function nudgeText(minutes) {
    return (
        `The runner: you have spent ${Math.round(minutes)} minutes on this; ask the advisor ` +
        `before going on (\`bin/advise "<question>" --output <failing output file>\`).`
    );
}

/**
 * Add a consult's usage to a session's advisor total.
 *
 * @param {AdvisorTotal | undefined} total - The total so far, if any.
 * @param {ConsultUsage} usage - The consult's usage.
 * @param {string} model - The advisor's model.
 * @returns {AdvisorTotal} The new total.
 */
export function addAdvisorUsage(total, usage, model) {
    return {
        model,
        consults: (total?.consults ?? 0) + 1,
        tokensIn: (total?.tokensIn ?? 0) + usage.tokensIn,
        cacheRead: (total?.cacheRead ?? 0) + usage.cacheRead,
        cacheWrite: (total?.cacheWrite ?? 0) + usage.cacheWrite,
        tokensOut: (total?.tokensOut ?? 0) + usage.tokensOut,
        costUsd: (total?.costUsd ?? 0) + usage.costUsd
    };
}
