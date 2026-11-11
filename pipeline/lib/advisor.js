/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Fable advisor: one resumable Claude session per epic (or per issue with no epic),
// which a stuck stage consults through bin/advise. Consults to one session run one at a
// time; each runs the claude adapter in a short container (sandbox.consult) and never
// blocks the pass. The answer goes back into the asking session's outbox.

import fs from "node:fs";
import path from "node:path";
import {
    SUMMARY_PROMPT,
    addAdvisorUsage,
    answerText,
    consultKey,
    consultPrompt,
    contextOf,
    recordComment,
    rollsOver
} from "./advice.js";
import {writeNew} from "./outbox.js";
import {addUsage} from "./state.js";

/**
 * @typedef {object} Job
 * @property {string} outbox - The asking session's outbox; the answer goes to advise/a-<n>.json.
 * @property {number} n - The question number.
 * @property {number} issue - The issue the session works on.
 * @property {number | null} epic - Its epic, if any.
 * @property {string} stage - The stage asking.
 * @property {import("./advice.js").Question} question - The question.
 * @property {{advisor?: import("./advice.js").AdvisorTotal}} session - The session record; the consult's usage is added to it.
 */

/**
 * @typedef {object} Call
 * @property {number} code - The container's exit status.
 * @property {string | null} answer - What the advisor said, if anything.
 * @property {string | null} session - The advisor session the call ran in.
 * @property {import("./outbox.js").Usage} usage - The call's usage.
 */

/** Usage with nothing in it. */
const NO_USAGE = {
    tokensIn: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokensOut: 0,
    costUsd: 0,
    turns: 0,
    status: "error"
};

/**
 * The tokens of a usage, all four counts.
 *
 * @param {import("./advice.js").ConsultUsage} usage - The usage.
 * @returns {number} The tokens.
 */
function tokensOf(usage) {
    return usage.tokensIn + usage.cacheRead + usage.cacheWrite + usage.tokensOut;
}

/**
 * The usage of calls, added up.
 *
 * @param {Call[]} calls - The calls.
 * @returns {import("./advice.js").ConsultUsage} Their usage.
 */
function sumUsage(calls) {
    const sum = {tokensIn: 0, cacheRead: 0, cacheWrite: 0, tokensOut: 0, costUsd: 0};
    for (const {usage} of calls) {
        sum.tokensIn += usage.tokensIn;
        sum.cacheRead += usage.cacheRead;
        sum.cacheWrite += usage.cacheWrite;
        sum.tokensOut += usage.tokensOut;
        sum.costUsd += usage.costUsd;
    }
    return sum;
}

/**
 * Read a file the adapter wrote, or null when there is none.
 *
 * @param {string} file - The path.
 * @returns {string | null} The text.
 */
function readOrNull(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return null;
    }
}

/**
 * The advisor sessions, their queues, and the consults they run.
 */
export class Advisor {
    /** @type {Map<string, Promise<void>>} */
    #queues = new Map();
    #disposed = false;
    #calls = 0;

    /**
     * @param {object} deps - What the advisor works with.
     * @param {{consult: (opts: {key: string, checkout: string, out: string, session: string | null, model: string}) => Promise<number>}} deps.sandbox - Runs one consult container.
     * @param {{issueBody: (n: number) => Promise<string>, planComment: (n: number) => Promise<string | null>}} deps.github - Reads the issue, its plan and the epic.
     * @param {import("./state.js").State} deps.state - The loop state: run.advisors, the issues and the run totals.
     * @param {any} deps.settings - The settings; `advisor` holds the model and the context cap.
     * @param {{now: () => number}} deps.clock - The clock.
     * @param {(line: string) => void} deps.log - The log.
     * @param {() => void} deps.save - Writes the state.
     * @param {(n: number, body: string) => Promise<void>} deps.comment - Posts a comment on an issue as ops, or queues it.
     * @param {string} deps.dir - Where the advisor's working directories and consult outboxes live.
     */
    constructor({sandbox, github, state, settings, clock, log, save, comment, dir}) {
        this.sandbox = sandbox;
        this.github = github;
        this.state = state;
        this.settings = settings;
        this.clock = clock;
        this.log = log;
        this.save = save;
        this.comment = comment;
        this.dir = dir;
        state.run.advisors ??= {};
    }

    /**
     * Queue a consult behind the others of its epic's session. Never rejects: a failure is
     * written as the answer.
     *
     * @param {Job} job - The consult.
     * @returns {Promise<void>} Settles once the answer is written.
     */
    ask(job) {
        if (this.#disposed) {
            answer(job, {error: "advisor stopped: the loop is shutting down"});
            return Promise.resolve();
        }
        const key = consultKey(job);
        const next = (this.#queues.get(key) ?? Promise.resolve()).then(() =>
            this.#consult(key, job)
        );
        this.#queues.set(key, next);
        void next.then(() => {
            if (this.#queues.get(key) === next) {
                this.#queues.delete(key);
            }
        });
        return next;
    }

    /**
     * Refuse new consults and wait for the queued ones.
     *
     * @returns {Promise<void>}
     */
    async dispose() {
        this.#disposed = true;
        await Promise.all(this.#queues.values());
    }

    /**
     * Run one consult and write its answer, or why there is none.
     *
     * @param {string} key - The advisor session's key.
     * @param {Job} job - The consult.
     * @returns {Promise<void>}
     */
    async #consult(key, job) {
        /** @type {Call[]} */
        const calls = [];
        try {
            const advice = await this.#advise(key, job, calls);
            answer(job, {advice});
        } catch (error) {
            this.log(`#${job.issue}: advisor failed: ${String(error)}`);
            answer(job, {error: `advisor failed: ${String(error)}`});
        }
        this.#count(job, calls);
        this.save();
    }

    /**
     * Ask the advisor: roll its session over when it grew too large, then consult it, then
     * record the consult on the issue.
     *
     * @param {string} key - The advisor session's key.
     * @param {Job} job - The consult.
     * @param {Call[]} calls - Where each call is recorded, for the usage.
     * @returns {Promise<string>} The advice.
     */
    async #advise(key, job, calls) {
        const model = this.settings.advisor.model;
        let entry = this.state.run.advisors[key] ?? null;
        let summary = null;
        if (rollsOver(entry, this.settings.advisor.maxContext)) {
            const call = await this.#call(key, entry.session, SUMMARY_PROMPT);
            calls.push(call);
            summary = call.answer;
            entry = null;
        }
        const prompt = consultPrompt({
            ...(await this.#context(job)),
            stage: job.stage,
            question: job.question.question,
            diff: job.question.diff,
            failing: job.question.failing,
            summary
        });
        let call = await this.#call(key, entry?.session ?? null, prompt);
        calls.push(call);
        if (!call.answer && entry && tokensOf(call.usage) === 0) {
            // The session's transcript is gone: start a new one.
            call = await this.#call(key, null, prompt);
            calls.push(call);
        }
        if (!call.answer) {
            throw new Error(`no answer (exit ${call.code}, ${call.usage.status})`);
        }
        this.state.run.advisors[key] = {session: call.session, context: contextOf(call.usage)};
        await this.comment(
            job.issue,
            recordComment({
                stage: job.stage,
                question: job.question.question,
                advice: call.answer,
                model,
                usage: sumUsage(calls)
            })
        );
        return call.answer;
    }

    /**
     * What a consult carries besides the question: the issue, its plan, and the epic with
     * its issues. A read GitHub refuses leaves a note in its place.
     *
     * @param {Job} job - The consult.
     * @returns {Promise<Pick<Parameters<typeof consultPrompt>[0], "issue" | "plan" | "epic">>} The context.
     */
    async #context(job) {
        const read = async (/** @type {() => Promise<string | null>} */ get) => {
            try {
                return await get();
            } catch (error) {
                this.log(`#${job.issue}: advisor context: ${String(error)}`);
                return null;
            }
        };
        const body = await read(() => this.github.issueBody(job.issue));
        const plan = await read(() => this.github.planComment(job.issue));
        const issue = {
            number: job.issue,
            title: this.state.issues[job.issue]?.title ?? "",
            body: body ?? "(the issue body could not be read)"
        };
        if (!job.epic) {
            return {issue, plan, epic: null};
        }
        const epicBody = await read(() => this.github.issueBody(/** @type {number} */ (job.epic)));
        const siblings = Object.entries(this.state.issues)
            .filter(([, r]) => r.epic === job.epic)
            .map(([n, r]) => ({number: Number(n), title: r.title, stage: r.stage}));
        return {
            issue,
            plan,
            epic: {
                number: job.epic,
                body: epicBody ?? "(the epic body could not be read)",
                siblings
            }
        };
    }

    /**
     * Run one call of the advisor in its own consult outbox: a new session, or a resume of
     * the one given. The working directory is the key's, every time, since Claude keeps a
     * session under the directory it ran in.
     *
     * @param {string} key - The advisor session's key.
     * @param {string | null} session - The session to resume; a new one when null.
     * @param {string} text - The prompt or the message.
     * @returns {Promise<Call>} The call.
     */
    async #call(key, session, text) {
        const checkout = path.join(this.dir, key);
        const out = path.join(this.dir, "out", `${key}-${this.clock.now()}-${++this.#calls}`);
        fs.mkdirSync(checkout, {recursive: true});
        fs.mkdirSync(out, {recursive: true});
        fs.writeFileSync(path.join(out, "prompt.md"), text);
        fs.writeFileSync(path.join(out, "allow.txt"), "");
        const model = this.settings.advisor.model;
        const code = await this.sandbox.consult({key, checkout, out, session, model});
        let usage = NO_USAGE;
        try {
            usage = {...NO_USAGE, ...JSON.parse(readOrNull(path.join(out, "usage.json")) ?? "")};
        } catch {
            // No usage.json: the call never reached the model.
        }
        return {
            code,
            answer: answerText(readOrNull(path.join(out, "stream.jsonl")) ?? ""),
            session: session ?? readOrNull(path.join(out, "session"))?.trim() ?? null,
            usage
        };
    }

    /**
     * Add the tokens of a consult's calls to the asking session and to the run totals.
     *
     * @param {Job} job - The consult.
     * @param {Call[]} calls - Its calls.
     * @returns {void}
     */
    #count(job, calls) {
        const model = this.settings.advisor.model;
        const spent = calls.filter(c => tokensOf(c.usage) > 0);
        for (const {usage} of spent) {
            addUsage(this.state, {tokens: tokensOf(usage), costUsd: usage.costUsd});
        }
        if (spent.length > 0) {
            job.session.advisor = addAdvisorUsage(job.session.advisor, sumUsage(spent), model);
        }
    }
}

/**
 * Write a consult's answer into the asking session's outbox.
 *
 * @param {Job} job - The consult.
 * @param {{advice: string} | {error: string}} body - The answer.
 * @returns {void}
 */
function answer(job, body) {
    writeNew(path.join(job.outbox, "advise"), `a-${job.n}.json`, JSON.stringify(body) + "\n");
}
