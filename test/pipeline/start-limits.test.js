// test/pipeline/start-limits.test.js: starting stages while a harness is at its usage limit:
// the other harnesses go on, an interrupted session resumes, or a fallback takes the stage.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {end, issue, world} from "./pass-world.js";

const MIN = 60 * 1000;

/**
 * Pause a harness for an hour from the world's now, as a reported reset.
 *
 * @param {any} w - The world.
 * @param {string} harness - The harness.
 * @returns {string} - When the pause ends.
 */
function pause(w, harness) {
    const until = new Date(w.clock.now() + 60 * MIN).toISOString();
    w.state.run.limits = {...w.state.run.limits, [harness]: {until, streak: 1, reported: true}};
    return until;
}

/**
 * Log a persona's profile in to a harness besides Claude.
 *
 * @param {any} w - The world.
 * @param {string} persona - The persona.
 * @param {string} harness - The harness.
 * @param {boolean} [loggedIn] - Whether the login holds.
 */
function login(w, persona, harness, loggedIn = true) {
    w.profiles[persona] = {...w.profiles[persona], [harness]: {present: true, loggedIn}};
}

describe("a harness at its usage limit", () => {
    test("a Codex stage starts while Claude is paused", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"]), issue(26, ["stage:review"])],
            env: {PIPELINE_HARNESS_REVIEW: "codex"}
        });
        login(w, "reviewer", "codex");
        const until = pause(w, "claude");
        const s = await w.p.pass();
        assert.deepEqual(s.started, [26]);
        assert.equal(w.starts[0].harness, "codex");
        assert.ok(w.logs.includes(`#25: waits, claude is at its usage limit until ${until}`));
    });
    test("a limit pauses its harness, not GitHub: the working label still comes off", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {exit: 75, status: "rate-limited"});
        await w.p.pass();
        assert.equal(w.state.sync.backoffUntil, null);
        assert.ok(w.state.run.limits.claude);
        assert.ok(w.calls.some(c => c[0] === "label" && c[1].remove.includes("working")));
    });
    test("wait: the interrupted session resumes after the reset, no try counted", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        end(w, outbox, "c25", {exit: 75, status: "rate-limited"});
        let s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.equal(w.state.issues[25].tries, 0);
        assert.equal(w.state.issues[25].interrupted.harness, "claude");
        w.clock.advance(16 * MIN);
        s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
        assert.deepEqual(w.starts[1].resume, {session: "s", carryFrom: outbox});
        assert.equal(w.outboxes[1].carryFrom, outbox);
        assert.match(w.outboxes[1].resume, /usage limit/);
        assert.equal(w.state.issues[25].interrupted, null);
        assert.equal(w.state.issues[25].tries, 0);
    });
    test("an interrupted session from another stage is not resumed", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        w.state.issues[25].interrupted = {
            harness: "claude",
            model: "claude-opus-5-5",
            session: "s",
            outbox: "/nowhere",
            persona: "builder",
            stage: "build"
        };
        await w.p.pass();
        assert.equal(w.starts[0].resume, undefined);
        assert.equal(w.outboxes[0].carryFrom, undefined);
        assert.equal(w.state.issues[25].interrupted, null);
    });
    test("fallback: the first logged-in entry starts fresh with the carry, and ops says so", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"])],
            env: {
                PIPELINE_ON_LIMIT: "fallback",
                PIPELINE_FALLBACK_CLAUDE: "codex:gpt-5.5,agy:gemini-3-pro"
            }
        });
        login(w, "builder", "codex");
        pause(w, "claude");
        w.state.issues[25].interrupted = {
            harness: "claude",
            model: "claude-opus-5-5",
            session: "s",
            outbox: "/carry",
            persona: "builder",
            stage: "build"
        };
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
        assert.equal(w.starts[0].harness, "codex");
        assert.equal(w.starts[0].model, "gpt-5.5");
        assert.equal(w.starts[0].resume, undefined);
        assert.equal(w.outboxes[0].carryFrom, "/carry");
        const comments = w.calls.filter(c => c[0] === "comment" && c[2] === 25);
        assert.deepEqual(comments, [
            [
                "comment",
                "ops",
                25,
                "Pipeline: build runs on codex gpt-5.5, not claude: claude is at its usage " +
                    "limit until 20:00 UTC (`PIPELINE_ON_LIMIT=fallback`)."
            ]
        ]);
    });
    test("fallback: an entry the persona is not logged in to is skipped", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"])],
            env: {
                PIPELINE_ON_LIMIT: "fallback",
                PIPELINE_FALLBACK_CLAUDE: "codex:gpt-5.5,agy:gemini-3-pro"
            }
        });
        login(w, "builder", "codex", false);
        login(w, "builder", "agy");
        pause(w, "claude");
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
        assert.equal(w.starts[0].harness, "agy");
        assert.equal(w.starts[0].model, "gemini-3-pro");
    });
    test("fallback with no entry that fits: the issue waits", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"])],
            env: {PIPELINE_ON_LIMIT: "fallback", PIPELINE_FALLBACK_CLAUDE: "codex:gpt-5.5"}
        });
        login(w, "builder", "codex", false);
        pause(w, "claude");
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.ok(!w.calls.some(c => c[0] === "comment"));
    });
    test("fallback with profiles off: no entry has a logged-in profile, so the issue waits", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"])],
            env: {
                PIPELINE_ON_LIMIT: "fallback",
                PIPELINE_FALLBACK_CLAUDE: "codex:gpt-5.5",
                PIPELINE_PROFILES: "off"
            }
        });
        const until = pause(w, "claude");
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.ok(w.logs.includes("fallback codex skipped: no logged-in profile for builder"));
        assert.ok(w.logs.includes(`#25: waits, claude is at its usage limit until ${until}`));
    });
    test("a spawn waits while its harness is paused, then starts", async () => {
        const w = world();
        const spawn = {persona: "advocate", prompt: "File Y", issue: null, harness: null};
        w.state.run.spawns.push(spawn);
        pause(w, "claude");
        await w.p.pass();
        assert.deepEqual(w.state.run.spawns, [spawn]);
        assert.equal(w.starts.length, 0);
        w.clock.advance(61 * MIN);
        await w.p.pass();
        assert.deepEqual(w.state.run.spawns, []);
        assert.equal(w.starts[0].stage, "spawn");
    });
    test("fallback: a spawn starts on the fallback", async () => {
        const w = world({
            env: {PIPELINE_ON_LIMIT: "fallback", PIPELINE_FALLBACK_CLAUDE: "codex:gpt-5.5"}
        });
        login(w, "advocate", "codex");
        w.state.run.spawns.push({
            persona: "advocate",
            prompt: "File Y",
            issue: null,
            harness: null
        });
        pause(w, "claude");
        await w.p.pass();
        assert.equal(w.starts[0].harness, "codex");
        assert.equal(w.starts[0].model, "gpt-5.5");
    });
});
