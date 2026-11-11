// test/pipeline/finish.test.js: judging an ended session, through the pass.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {end, issue, world} from "./pass-world.js";

/**
 * Run one session of issue 25 at a stage to its end with the given requests.
 *
 * @param {string} stage - The stage label the issue starts at.
 * @param {Record<string, any>} requests - The request files, by name.
 * @param {object} [extra] - What else the session left (exit, hooks, status).
 * @returns {Promise<any>} - The world after the judging pass.
 */
async function session(stage, requests, extra = {}) {
    const w = world({issues: [issue(25, [stage])]});
    await w.p.pass();
    end(w, w.state.issues[25].session.outbox, "c25", {requests, ...extra});
    w.summary = await w.p.pass();
    return w;
}

describe("a done request is checked against the stage the session ran", () => {
    test("plan may not move an issue to stage:done; the session is a try", async () => {
        const w = await session("stage:todo", {done: {done: {issue: 25, to: "stage:done"}}});
        assert.equal(w.state.issues[25].stage, "stage:todo");
        assert.equal(w.state.issues[25].tries, 1);
        assert.ok(w.logs.some((/** @type {string} */ l) => /refused done .*stage:done/.test(l)));
    });
    test("qa may move an issue to stage:done", async () => {
        const w = await session("stage:qa", {done: {done: {issue: 25, to: "stage:done"}}});
        assert.equal(w.state.issues[25].stage, "stage:done");
        assert.equal(w.state.issues[25].tries, 0);
    });
    test("review may send an issue back to stage:in-progress, tests may not skip to qa", async () => {
        const back = await session("stage:review", {
            done: {done: {issue: 25, to: "stage:in-progress"}}
        });
        assert.equal(back.state.issues[25].stage, "stage:in-progress");
        const skip = await session("stage:tests", {done: {done: {issue: 25, to: "stage:qa"}}});
        assert.equal(skip.state.issues[25].stage, "stage:tests");
    });
    test("any stage may park or send to triage", async () => {
        const w = await session("stage:in-progress", {done: {done: {issue: 25, to: "triage"}}});
        assert.equal(w.state.issues[25].stage, null);
        assert.ok(w.state.issues[25].labels.includes("triage"));
    });
});

describe("waiting for a person", () => {
    test("a note with no done request is a try, not a wait", async () => {
        const w = await session("stage:todo", {note: {note: "plan posted; waiting"}});
        assert.equal(w.state.issues[25].tries, 1);
        assert.equal(w.state.issues[25].waiting, false);
    });
    test("a wait request marks the issue waiting, logged, no try", async () => {
        const w = await session("stage:todo", {wait: {wait: "plan posted for #25"}});
        assert.equal(w.state.issues[25].tries, 0);
        assert.equal(w.state.issues[25].waiting, true);
        assert.ok(w.logs.some((/** @type {string} */ l) => /waiting.*plan posted for #25/.test(l)));
    });
    test("a wait from a session whose checks did not run is a try", async () => {
        const w = await session("stage:todo", {wait: {wait: "w"}}, {hooks: "error"});
        assert.equal(w.state.issues[25].waiting, false);
        assert.equal(w.state.issues[25].tries, 1);
    });
});

describe("saving and the outside checks", () => {
    test("the state is saved right after judging, before the slot is freed", async () => {
        /** @type {{stage: string, judged: boolean}[]} */
        const saves = [];
        const w = world({
            issues: [issue(25, ["stage:todo"])],
            save: s =>
                saves.push({stage: s.issues[25].stage, judged: !!s.issues[25].session?.judged})
        });
        await w.p.pass();
        saves.length = 0;
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {done: {done: {issue: 25, to: "stage:tests"}}}
        });
        await w.p.pass();
        assert.deepEqual(saves.slice(0, 2), [
            {stage: "stage:todo", judged: true},
            {stage: "stage:tests", judged: true}
        ]);
    });
    test("a session whose outside checks did not run is a try even with a done", async () => {
        const w = await session(
            "stage:todo",
            {done: {done: {issue: 25, to: "stage:tests"}}},
            {exit: 1, hooks: "skipped"}
        );
        assert.equal(w.state.issues[25].stage, "stage:todo");
        assert.equal(w.state.issues[25].tries, 1);
        assert.ok(w.logs.some((/** @type {string} */ l) => /checks did not run/.test(l)));
    });
});

describe("a session whose login died", () => {
    const line = "builder: logged out; run npm run pipeline -- --login builder";
    test("costs no try and marks its persona, logged once", async () => {
        const w = await session("stage:in-progress", {}, {exit: 1, status: "auth"});
        assert.equal(w.state.issues[25].tries, 0);
        assert.equal(w.state.issues[25].stage, "stage:in-progress");
        assert.ok(w.state.run.loggedOut.builder);
        assert.equal(w.logs.filter((/** @type {string} */ l) => l === line).length, 1);
    });
    test("marks the persona of a spawned session too", async () => {
        const w = await session("stage:in-progress", {
            done: {done: {issue: 25, to: "stage:review"}},
            spawn: {spawn: {persona: "advocate", prompt: "file it"}}
        });
        const spawned = w.state.run.sessions[0];
        end(w, spawned.outbox, spawned.container, {exit: 1, status: "auth"});
        await w.p.pass();
        assert.ok(w.state.run.loggedOut.advocate);
        assert.ok(
            w.logs.includes("advocate: logged out; run npm run pipeline -- --login advocate")
        );
    });
});

describe("spawned sessions", () => {
    test("a spawned session may not spawn again", async () => {
        const w = await session("stage:in-progress", {
            done: {done: {issue: 25, to: "stage:review"}},
            spawn: {spawn: {persona: "advocate", prompt: "file it"}}
        });
        const spawned = w.state.run.sessions[0];
        end(w, spawned.outbox, spawned.container, {
            requests: {spawn: {spawn: {persona: "qa", prompt: "and again"}}}
        });
        await w.p.pass();
        assert.deepEqual(w.state.run.spawns, []);
        assert.ok(w.logs.some((/** @type {string} */ l) => /refused spawn.*depth/.test(l)));
    });
    test("a spawn that fails to start is dropped with a log line", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {
                done: {done: {issue: 25, to: "stage:review"}},
                spawn: {spawn: {persona: "advocate", prompt: "file it"}}
            }
        });
        const sandboxStart = w.sandbox.start;
        w.sandbox.start = async (/** @type {any} */ o) => {
            if (o.stage === "spawn") {
                throw new Error("docker: no space left");
            }
            return sandboxStart(o);
        };
        await w.p.pass();
        assert.deepEqual(w.state.run.spawns, []);
        assert.ok(w.logs.some((/** @type {string} */ l) => /spawn advocate dropped/.test(l)));
    });
});

/**
 * The comments the pass posted, as [persona, issue, body].
 *
 * @param {any} w - The world.
 * @returns {any[][]} The comments.
 */
function comments(w) {
    return w.calls.filter((/** @type {any[]} */ c) => c[0] === "comment").map(c => c.slice(1));
}

describe("the usage comment", () => {
    /**
     * Run a build session of issue 25 for 18m 04s to its end.
     *
     * @param {object} extra - What the session left.
     * @returns {Promise<any>} The world after the judging pass, and the session's outbox.
     */
    async function build(extra) {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        w.clock.advance((18 * 60 + 4) * 1000);
        end(w, outbox, "c25", {
            requests: {done: {done: {issue: 25, to: "stage:review"}}},
            ...extra
        });
        await w.p.pass();
        return {w, outbox: path.basename(outbox)};
    }
    test("an ok session gets one ops comment with its usage folded away", async () => {
        const usage = {tokensIn: 12034, cacheRead: 180200, cacheWrite: 9933, tokensOut: 10120};
        const {w, outbox} = await build({usage: {...usage, turns: 41}, resumes: 2});
        assert.deepEqual(comments(w), [
            [
                "ops",
                25,
                "<details>\n" +
                    "<summary>⏱ build · claude claude-opus-5-5 · 212k tokens · 41 turns · 18m · ok</summary>\n" +
                    "\n" +
                    "| | |\n" +
                    "|---|---|\n" +
                    "| Stage | build (try 1) |\n" +
                    "| Harness / model | claude / claude-opus-5-5 |\n" +
                    "| Tokens | in 12,034 · cache read 180,200 · cache write 9,933 · out 10,120 |\n" +
                    "| Turns | 41 (2 resumes) |\n" +
                    "| Wall time | 18m 04s |\n" +
                    "| Cost (notional) | $0.00 |\n" +
                    "| Result | ok · exit 0 · hooks ok |\n" +
                    `| Outbox | ${outbox} |\n` +
                    "</details>"
            ]
        ]);
        assert.equal(w.state.run.tokens, 212287);
    });
    test("a session without usage.json still gets the comment, its counts unknown", async () => {
        const {w} = await build({usage: null, exit: 1, hooks: "skipped"});
        const [[, n, body]] = comments(w);
        assert.equal(n, 25);
        assert.match(
            body,
            /<summary>⏱ build · claude claude-opus-5-5 · unknown tokens · unknown turns · 18m · unknown<\/summary>/
        );
        assert.match(body, /\| Tokens \| unknown \|/);
        assert.match(body, /\| Result \| unknown · exit 1 · hooks skipped \|/);
    });
    test("while GitHub is backed off the comment waits in the queue", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        w.state.sync.backoffUntil = new Date(w.clock.now() + 3600 * 1000).toISOString();
        end(w, w.state.issues[25].session.outbox, "c25");
        await w.p.pass();
        assert.deepEqual(comments(w), []);
        const queued = w.state.queued.filter((/** @type {any} */ q) => q.comment);
        assert.equal(queued.length, 1);
        assert.equal(queued[0].comment.persona, "ops");
        assert.equal(queued[0].comment.issue, 25);
        assert.match(queued[0].comment.body, /^<details>\n<summary>⏱ build · /);
    });
    test("a session already judged posts nothing again", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        w.state.issues[25].session.judged = true;
        end(w, w.state.issues[25].session.outbox, "c25");
        await w.p.pass();
        assert.deepEqual(comments(w), []);
    });
    test("a spawned session with an issue comments there, one without an issue does not", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {
                done: {done: {issue: 25, to: "stage:review"}},
                // Another issue, so the fake gives the spawn its own container.
                spawn: {spawn: {persona: "advocate", prompt: "file it", issue: 30}}
            }
        });
        await w.p.pass();
        w.calls.length = 0;
        const spawned = w.state.run.sessions[0];
        end(w, spawned.outbox, spawned.container);
        await w.p.pass();
        const [[persona, n, body]] = comments(w);
        assert.equal(persona, "ops");
        assert.equal(n, 30);
        assert.match(body, /<summary>⏱ spawn \(advocate\) · claude /);

        const lone = world({issues: [issue(26, ["stage:in-progress"])]});
        await lone.p.pass();
        end(lone, lone.state.issues[26].session.outbox, "c26", {
            requests: {
                done: {done: {issue: 26, to: "stage:review"}},
                spawn: {spawn: {persona: "advocate", prompt: "file it"}}
            }
        });
        await lone.p.pass();
        lone.calls.length = 0;
        const alone = lone.state.run.sessions[0];
        end(lone, alone.outbox, alone.container);
        await lone.p.pass();
        assert.deepEqual(comments(lone), []);
    });
});

describe("judging a session stopped at its usage limit", () => {
    test("a profile session is kept to resume", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        end(w, outbox, "c25", {exit: 75, status: "rate-limited"});
        await w.p.pass();
        assert.deepEqual(w.state.issues[25].interrupted, {
            harness: "claude",
            model: "claude-opus-5-5",
            session: "s",
            outbox,
            persona: "builder",
            stage: "build"
        });
    });
    test("a token-only session keeps its carry but no session to resume", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"])],
            env: {CLAUDE_CODE_OAUTH_TOKEN: "t"}
        });
        w.profiles.builder = null;
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        end(w, outbox, "c25", {exit: 75, status: "rate-limited"});
        await w.p.pass();
        assert.equal(w.state.issues[25].interrupted.session, null);
        assert.equal(w.state.issues[25].interrupted.outbox, outbox);
    });
    test("a carry that did not apply keeps the interruption and counts a try", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        const gone = {
            harness: "claude",
            model: "claude-opus-5-5",
            session: "s0",
            outbox: "/carry",
            persona: "builder",
            stage: "build"
        };
        w.state.issues[25].interrupted = gone;
        await w.p.pass();
        assert.equal(w.state.issues[25].interrupted, null);
        const outbox = w.state.issues[25].session.outbox;
        end(w, outbox, "c25", {exit: 1, status: "error", hooks: "skipped", carry: "failed"});
        await w.p.pass();
        assert.deepEqual(w.state.issues[25].interrupted, gone);
        assert.equal(w.state.issues[25].tries, 1);
        assert.ok(w.logs.some(l => /#25: the carried work did not apply/.test(l)));
    });
    test("a session that ended for another reason is not interrupted", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {exit: 1, status: "error"});
        await w.p.pass();
        assert.equal(w.state.issues[25].interrupted ?? null, null);
    });
});
