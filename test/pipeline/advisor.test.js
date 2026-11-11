// test/pipeline/advisor.test.js: the advisor's per-epic sessions, run over the claude adapter and its fake.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Advisor} from "../../pipeline/lib/advisor.js";
import {applyIssue, emptyState} from "../../pipeline/lib/state.js";
import {loadConfig} from "../../pipeline/lib/config.js";
import {fake, root} from "./harness-adapter.js";

/**
 * A sandbox whose consult runs the claude adapter on the host over the fake CLI, a little
 * slowly, recording each call and how many ran at once.
 *
 * @param {string} argsFile - Where the fake CLI appends its arguments.
 * @returns {any} The sandbox and its records.
 */
function fakeSandbox(argsFile) {
    const record = {calls: /** @type {any[]} */ ([]), active: 0, most: 0};
    return {
        record,
        async consult(/** @type {any} */ opts) {
            record.calls.push(opts);
            record.active++;
            record.most = Math.max(record.most, record.active);
            await new Promise(resolve => setTimeout(resolve, 20));
            const mode = opts.session
                ? ["resume", "--session", opts.session, "--message"]
                : ["run", "--prompt"];
            const args = [
                path.join(root, "pipeline/harness/claude"),
                ...mode,
                path.join(opts.out, "prompt.md"),
                "--model",
                opts.model,
                "--allow",
                path.join(opts.out, "allow.txt"),
                "--checkout",
                opts.checkout,
                "--out",
                opts.out
            ];
            const env = {...process.env, CLAUDE_BIN: fake, FAKE_ARGS: argsFile};
            const code = await new Promise(resolve => {
                const child = spawn("bash", args, {env, stdio: "ignore"});
                child.on("close", resolve);
            });
            record.active--;
            return code;
        }
    };
}

/**
 * An advisor over fakes, with issues 7 and 8 in epic 123 and issue 9 in none.
 *
 * @param {Record<string, string>} [env] - Settings.
 * @returns {any} The advisor, its state and records.
 */
function world(env = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adv-"));
    const argsFile = path.join(dir, "args");
    const state = emptyState();
    for (const [number, epic] of [
        [7, 123],
        [8, 123],
        [9, null]
    ]) {
        applyIssue(state, {
            number: /** @type {number} */ (number),
            title: `t${number}`,
            labels: ["stage:in-progress"],
            state: "OPEN",
            body: epic ? `Part of #${epic}` : ""
        });
    }
    const comments = /** @type {any[]} */ ([]);
    const sandbox = fakeSandbox(argsFile);
    const github = {
        issueBody: async (/** @type {number} */ n) => `body of #${n}`,
        planComment: async (/** @type {number} */ n) => `## Implementation Plan\nplan of #${n}`
    };
    const advisor = new Advisor({
        sandbox,
        github,
        state,
        settings: loadConfig({root: "/nonexistent", env}),
        clock: {now: () => Date.parse("2026-11-11T15:00:00Z")},
        log: () => {},
        save: () => {},
        comment: async (/** @type {number} */ n, /** @type {string} */ body) => {
            comments.push([n, body]);
        },
        dir: path.join(dir, "advisors")
    });
    return {advisor, state, comments, sandbox, dir, argsFile};
}

/**
 * Ask the advisor one question for an issue, with a fresh outbox and session record.
 *
 * @param {any} w - The world.
 * @param {number} issue - The issue.
 * @param {string} question - The question.
 * @returns {{done: Promise<void>, outbox: string, session: any}} The consult, the outbox it answers in, and the session record.
 */
function ask(w, issue, question) {
    const outbox = fs.mkdtempSync(path.join(w.dir, "ob-"));
    fs.mkdirSync(path.join(outbox, "advise"));
    const session = {stage: "build"};
    const done = w.advisor.ask({
        outbox,
        n: 1,
        issue,
        epic: w.state.issues[issue].epic,
        stage: "build",
        question: {question, stage: "build", diff: "", failing: ""},
        session
    });
    return {done, outbox, session};
}

/**
 * The answer file of question 1 in an outbox.
 *
 * @param {string} outbox - The outbox.
 * @returns {any} The parsed answer.
 */
function answer(outbox) {
    return JSON.parse(fs.readFileSync(path.join(outbox, "advise", "a-1.json"), "utf8"));
}

describe("Advisor", () => {
    test("answers in the outbox, records the consult and counts its tokens", async () => {
        const w = world();
        const a = ask(w, 7, "Why does it fail?");
        await a.done;
        assert.deepEqual(answer(a.outbox), {advice: "hello from fake"});
        assert.equal(w.comments.length, 1);
        assert.equal(w.comments[0][0], 7);
        assert.match(w.comments[0][1], /🧭 advisor · build · claude-fable-5-1 · 1k tokens/);
        assert.match(w.comments[0][1], /> Why does it fail\?/);
        assert.deepEqual(a.session.advisor, {
            model: "claude-fable-5-1",
            consults: 1,
            tokensIn: 100,
            cacheRead: 1000,
            cacheWrite: 50,
            tokensOut: 20,
            costUsd: 0.12
        });
        assert.equal(w.state.run.tokens, 1170);
        const prompt = fs.readFileSync(
            path.join(w.sandbox.record.calls[0].out, "prompt.md"),
            "utf8"
        );
        assert.ok(prompt.includes("body of #7"));
        assert.ok(prompt.includes("plan of #7"));
        assert.ok(prompt.includes("body of #123"));
        assert.ok(prompt.includes("- #8 t8 (stage:in-progress)"));
    });

    test("two issues of one epic resume one session, in turn, never at once", async () => {
        const w = world();
        const first = ask(w, 7, "first");
        const second = ask(w, 8, "second");
        await Promise.all([first.done, second.done]);
        const [one, two] = w.sandbox.record.calls;
        assert.equal(w.sandbox.record.most, 1);
        assert.equal(one.session, null);
        assert.equal(one.checkout, two.checkout, "resume needs the same working directory");
        const session = w.state.run.advisors["123"].session;
        assert.match(session, /^[0-9a-f-]{36}$/);
        assert.equal(two.session, session);
        // The prompt spans lines, so the calls are told apart by their session flags.
        const args = fs.readFileSync(w.argsFile, "utf8");
        assert.equal(args.match(/--session-id /g)?.length, 1);
        assert.match(args, new RegExp(`--resume ${session} `));
        assert.deepEqual(answer(second.outbox), {advice: "hello from fake"});
    });

    test("an issue of another epic, or of none, gets its own session", async () => {
        const w = world();
        await ask(w, 7, "first").done;
        await ask(w, 9, "other").done;
        const [one, two] = w.sandbox.record.calls;
        assert.equal(two.session, null);
        assert.notEqual(one.checkout, two.checkout);
        assert.notEqual(
            w.state.run.advisors["issue-9"].session,
            w.state.run.advisors["123"].session
        );
    });

    test("a session past the context cap is summarised and a new one seeded with it", async () => {
        const w = world({PIPELINE_ADVISOR_MAX_CONTEXT: "300"});
        await ask(w, 7, "first").done;
        const old = w.state.run.advisors["123"].session;
        assert.ok(w.state.run.advisors["123"].context >= 300);
        await ask(w, 8, "second").done;
        const [, summary, fresh] = w.sandbox.record.calls;
        assert.equal(summary.session, old);
        assert.match(fs.readFileSync(path.join(summary.out, "prompt.md"), "utf8"), /[Ss]ummar/);
        assert.equal(fresh.session, null);
        const seeded = fs.readFileSync(path.join(fresh.out, "prompt.md"), "utf8");
        assert.ok(seeded.includes("hello from fake"), "the summary seeds the new session");
        assert.notEqual(w.state.run.advisors["123"].session, old);
    });

    test("a consult that gets no answer says so in the outbox", async () => {
        const w = world();
        w.sandbox.consult = async () => 1;
        const a = ask(w, 7, "q");
        await a.done;
        assert.match(answer(a.outbox).error, /advisor failed/);
        assert.equal(w.comments.length, 0);
    });

    test("dispose waits for the consults and refuses new ones", async () => {
        const w = world();
        const a = ask(w, 7, "q");
        await w.advisor.dispose();
        assert.deepEqual(answer(a.outbox), {advice: "hello from fake"});
        const b = ask(w, 8, "late");
        await b.done;
        assert.match(answer(b.outbox).error, /advisor stopped/);
        await a.done;
    });
});
