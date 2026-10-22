// test/pipeline/finish.test.js: judging an ended session, through the pass.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
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
