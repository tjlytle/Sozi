/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The pass's advisor side: each running issue session's questions (advise/q-<n>.json,
// written by bin/advise) are read once and handed to the advisor, or refused past the
// session's limit; a session past its share of the time gets one nudge (nudge.md, which
// pipeline/nudge.sh prints to the agent).

import fs from "node:fs";
import path from "node:path";
import {MAX_QUESTION_FILE_BYTES, nudgeText, parseQuestion, refusal} from "./advice.js";
import {readBounded, writeNew} from "./outbox.js";

/**
 * @typedef {import("./sync.js").PassContext & {advisor: {ask: (job: import("./advisor.js").Job) => Promise<void>, dispose: () => Promise<void>}}} ConsultContext
 */

/**
 * @typedef {object} ConsultSession
 * @property {string} outbox - The session's outbox.
 * @property {string} started - When it started.
 * @property {string} stage - The prompt stage.
 * @property {boolean} [judged] - Set once the session ended.
 * @property {number[]} [questions] - The question numbers read, handed over or answered.
 * @property {number} [consults] - The questions handed to the advisor.
 * @property {boolean} [nudged] - Whether the nudge was written.
 * @property {import("./advice.js").AdvisorTotal} [advisor] - The advisor consults it made, for its usage comment.
 */

/**
 * The question numbers waiting in an outbox's advise directory, in order. A directory that
 * is a link, or missing, holds none.
 *
 * @param {string} dir - The advise directory.
 * @returns {number[]} The numbers.
 */
function questionNumbers(dir) {
    if (!fs.lstatSync(dir, {throwIfNoEntry: false})?.isDirectory()) {
        return [];
    }
    return fs
        .readdirSync(dir)
        .filter(name => /^q-\d+\.json$/.test(name))
        .map(name => Number(name.slice(2, -5)))
        .sort((a, b) => a - b);
}

/**
 * Read a session's new questions once each: hand a valid one to the advisor while the
 * session has consults left, and answer the rest with why not.
 *
 * @param {ConsultContext} ctx - The pass context.
 * @param {number} issue - The issue the session works on.
 * @param {ConsultSession} session - The session.
 * @returns {void}
 */
function readQuestions(ctx, issue, session) {
    const dir = path.join(session.outbox, "advise");
    const max = ctx.settings.advisor.max;
    session.questions ??= [];
    for (const n of questionNumbers(dir)) {
        if (session.questions.includes(n)) {
            continue;
        }
        session.questions.push(n);
        ctx.summary.consults++;
        const reply = (/** @type {object} */ body) =>
            writeNew(dir, `a-${n}.json`, JSON.stringify(body) + "\n");
        const read = readBounded(path.join(dir, `q-${n}.json`), MAX_QUESTION_FILE_BYTES);
        let question;
        try {
            if ("refused" in read) {
                throw new Error(`question file ${read.refused}`);
            }
            question = parseQuestion(read.text, {issue});
        } catch (error) {
            ctx.log(`#${issue}: question ${n} refused: ${String(error)}`);
            reply({error: error instanceof Error ? error.message : String(error)});
            continue;
        }
        if ((session.consults ?? 0) >= max) {
            ctx.log(`#${issue}: question ${n} refused: the limit is ${max}`);
            reply({refused: refusal(max)});
            continue;
        }
        session.consults = (session.consults ?? 0) + 1;
        const epic = ctx.state.issues[issue].epic;
        ctx.log(`#${issue}: question ${n} handed to the advisor`);
        void ctx.advisor.ask({
            outbox: session.outbox,
            n,
            issue,
            epic,
            stage: session.stage,
            question,
            session
        });
    }
}

/**
 * Write a session's nudge once it has used its share of the time.
 *
 * @param {ConsultContext} ctx - The pass context.
 * @param {number} issue - The issue the session works on.
 * @param {ConsultSession} session - The session.
 * @returns {void}
 */
function nudge(ctx, issue, session) {
    const {sessionMinutes} = ctx.settings;
    const share = ctx.settings.advisor.nudgeShare;
    if (session.nudged || share <= 0 || sessionMinutes <= 0) {
        return;
    }
    const minutes = (ctx.clock.now() - Date.parse(session.started)) / 60000;
    if (minutes < share * sessionMinutes) {
        return;
    }
    session.nudged = true;
    writeNew(session.outbox, "nudge.md", nudgeText(minutes) + "\n");
    ctx.log(`#${issue}: nudged after ${Math.round(minutes)} minutes`);
}

/**
 * Hand every running issue session's new questions to the advisor and nudge the sessions
 * past their share of the time.
 *
 * @param {ConsultContext} ctx - The pass context.
 * @returns {void}
 */
export function consult(ctx) {
    for (const [key, record] of Object.entries(ctx.state.issues)) {
        const session = /** @type {ConsultSession | null} */ (record.session);
        if (session && !session.judged) {
            nudge(ctx, Number(key), session);
            readQuestions(ctx, Number(key), session);
        }
    }
}
