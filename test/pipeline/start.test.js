// test/pipeline/start.test.js: which sessions the pass starts: persona profiles, persona limits and the order.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {RateLimited} from "../../pipeline/lib/github.js";
import {end, issue, world} from "./pass-world.js";

describe("persona profiles at start", () => {
    test("a stage starts with its persona's profile", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        assert.equal(w.starts.length, 1);
        assert.equal(w.starts[0].persona, "builder");
        assert.equal(w.starts[0].profile, true);
        assert.equal(w.state.issues[25].session.persona, "builder");
    });
    test("an issue's session records its harness, model and try", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"])],
            env: {PIPELINE_HARNESS_BUILD: "codex", PIPELINE_MODEL_BUILD: "gpt-6.1-sol"}
        });
        w.profiles.builder.codex = {present: true, loggedIn: true};
        w.state.issues[25].tries = 1;
        await w.p.pass();
        const {harness, model, try: attempt} = w.state.issues[25].session;
        assert.deepEqual(
            {harness, model, attempt},
            {harness: "codex", model: "gpt-6.1-sol", attempt: 2}
        );
    });
    test("a spawned session records its harness and model", async () => {
        const w = world({env: {PIPELINE_MODEL_QA: "qa-model"}});
        w.state.run.spawns.push({
            persona: "advocate",
            prompt: "File Y",
            issue: null,
            harness: "codex"
        });
        w.profiles.advocate.codex = {present: true, loggedIn: true};
        await w.p.pass();
        const {harness, model} = w.state.run.sessions[0];
        assert.deepEqual({harness, model}, {harness: "codex", model: "qa-model"});
    });
    test("no profile and no token: the start is refused and logged, no working label", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        w.profiles.builder = null;
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.equal(w.state.issues[25].session, null);
        assert.equal(w.starts.length, 0);
        assert.ok(
            w.logs.some(l =>
                /no profile for builder: run npm run pipeline -- --login builder/.test(l)
            )
        );
        assert.ok(!w.state.issues[25].labels.includes("working"));
        assert.ok(!w.calls.some(c => c[0] === "label" && c[1].add.includes("working")));
    });
    test("a container that fails to start takes the working label off and the pass logs it", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        w.sandbox.start = async () => {
            throw new Error("docker refused");
        };
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.ok(
            w.logs.some(l => /start failed, no more starts this pass: .*docker refused/.test(l))
        );
        const labels = w.calls.filter(c => c[0] === "label").map(c => c[1]);
        const added = labels.findIndex(op => op.add.includes("working"));
        const removed = labels.findIndex(op => op.remove.includes("working"));
        assert.ok(added >= 0 && removed > added);
        assert.ok(!w.state.issues[25].labels.includes("working"));
        assert.equal(w.state.issues[25].session, null);
    });
    test("no profile but a token: starts without a profile", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"])],
            env: {CLAUDE_CODE_OAUTH_TOKEN: "t"}
        });
        w.profiles.builder = null;
        await w.p.pass();
        assert.equal(w.starts.length, 1);
        assert.equal(w.starts[0].persona, "builder");
        assert.equal(w.starts[0].profile, false);
    });
    test("a server outside the allowlist refuses the start by name", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        w.profiles.builder = {
            ...w.profiles.builder,
            claude: {present: true, loggedIn: true, servers: ["mobbin"]}
        };
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        const refusals = w.logs.filter(l => /not allowed/.test(l));
        assert.deepEqual(refusals, ["profile of builder holds MCP servers not allowed: mobbin"]);
        assert.ok(!w.logs.some(l => /loggedIn|present|writable|codex/.test(l)));
    });
    test("one session per persona: the second builder issue waits, a qa issue starts", async () => {
        const w = world({
            issues: [
                issue(25, ["stage:in-progress"]),
                issue(26, ["stage:in-progress"]),
                issue(27, ["stage:tests"])
            ],
            env: {PIPELINE_PARALLEL: "3"}
        });
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25, 27]);
        assert.ok(w.state.issues[25].session);
        assert.ok(w.state.issues[27].session);
        assert.equal(w.state.issues[26].session, null);
        assert.ok(!w.state.issues[26].labels.includes("working"));
        assert.deepEqual(w.state.deadLetters, []);
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {done: {done: {issue: 25, to: "stage:review"}}}
        });
        const next = await w.p.pass();
        assert.deepEqual(next.started, [25, 26], "the waiting builder starts once one is free");
    });
    test("PIPELINE_PER_PERSONA=0 lifts the limit", async () => {
        const w = world({
            issues: [
                issue(25, ["stage:in-progress"]),
                issue(26, ["stage:in-progress"]),
                issue(27, ["stage:tests"])
            ],
            env: {PIPELINE_PARALLEL: "3", PIPELINE_PER_PERSONA: "0"}
        });
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25, 27, 26]);
    });
    test("a profile that is not logged in refuses the start, no working label", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        w.profiles.builder = {
            ...w.profiles.builder,
            claude: {present: true, loggedIn: false, servers: []}
        };
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.equal(w.starts.length, 0);
        assert.ok(w.logs.includes("profile of builder is not logged in"));
        assert.ok(!w.state.issues[25].labels.includes("working"));
        assert.ok(!w.calls.some(c => c[0] === "label" && c[1].add.includes("working")));
    });
    test("a stage on codex needs the codex login, not the claude one", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"])],
            env: {PIPELINE_HARNESS_BUILD: "codex"}
        });
        w.profiles.builder = {...w.profiles.builder, codex: {present: true, loggedIn: false}};
        let s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.ok(
            w.logs.includes(
                "profile of builder is not logged in to codex: run npm run pipeline -- --login builder --harness codex"
            )
        );
        w.profiles.builder = {
            ...w.profiles.builder,
            claude: {present: true, loggedIn: false, servers: []},
            codex: {present: true, loggedIn: true}
        };
        s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
    });
    test("a Claude token does not stand in for a missing profile on codex", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"])],
            env: {PIPELINE_HARNESS_BUILD: "codex", CLAUDE_CODE_OAUTH_TOKEN: "t"}
        });
        w.profiles.builder = null;
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.ok(
            w.logs.includes(
                "no profile for builder: run npm run pipeline -- --login builder --harness codex"
            )
        );
    });
    test("an issue at its persona limit waits with a log line", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"]), issue(26, ["stage:in-progress"])]
        });
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
        assert.ok(w.logs.includes("#26: waits, builder at its limit"));
    });
    test("a spawn at its persona limit stays queued; the next spawn and an issue start", async () => {
        const w = world({issues: [issue(27, ["stage:tests"])], env: {PIPELINE_PARALLEL: "3"}});
        w.containers.cb = "running";
        const started = new Date(w.clock.now()).toISOString();
        const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "ob-"));
        w.state.run.sessions.push({container: "cb", started, outbox, persona: "builder", issue: 0});
        const waiting = {persona: "builder", prompt: "Build X", issue: null, harness: null};
        const next = {persona: "advocate", prompt: "File Y", issue: null, harness: null};
        w.state.run.spawns.push(waiting, next);
        const s = await w.p.pass();
        assert.deepEqual(w.state.run.spawns, [waiting], "the builder spawn stays queued");
        assert.deepEqual(
            w.starts.map((/** @type {any} */ o) => [o.stage, o.persona]),
            [
                ["spawn", "advocate"],
                ["tests", "qa"]
            ]
        );
        assert.deepEqual(s.started, [27]);
    });
    test("a spawn whose profile is refused is dropped and the pass goes on", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        w.profiles.advocate = null;
        w.state.run.spawns.push({
            persona: "advocate",
            prompt: "File Y",
            issue: null,
            harness: null
        });
        const s = await w.p.pass();
        assert.deepEqual(w.state.run.spawns, []);
        assert.ok(
            w.logs.includes("no profile for advocate: run npm run pipeline -- --login advocate")
        );
        assert.ok(w.logs.includes("spawn advocate dropped"));
        assert.ok(!w.starts.some((/** @type {any} */ o) => o.stage === "spawn"));
        assert.deepEqual(s.started, [25]);
    });
});

/**
 * Mark a session of a persona as running, the way a spawn records it.
 *
 * @param {any} w - The world.
 * @param {string} persona - The persona.
 * @param {string} container - The container id.
 */
function running(w, persona, container) {
    w.containers[container] = "running";
    const started = new Date(w.clock.now()).toISOString();
    const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "ob-"));
    w.state.run.sessions.push({container, started, outbox, persona, issue: 0});
}

/**
 * Mark an issue's session as running for a persona.
 *
 * @param {any} w - The world.
 * @param {number} n - The issue number.
 * @param {string} persona - The persona.
 */
function runningIssue(w, n, persona) {
    const container = `c${n}`;
    w.containers[container] = "running";
    const started = new Date(w.clock.now()).toISOString();
    const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "ob-"));
    w.state.issues[n].session = {container, started, stage: "build", outbox, persona};
}

describe("choosing the next issue", () => {
    test("the issue of the least-busy persona starts first", async () => {
        const w = world({
            issues: [
                issue(1, ["stage:in-progress", "working"]),
                issue(2, ["stage:in-progress", "working"]),
                issue(10, ["stage:todo"]),
                issue(11, ["stage:in-progress"]),
                issue(12, ["stage:qa"])
            ],
            env: {PIPELINE_PARALLEL: "4", PIPELINE_PER_PERSONA: "0"}
        });
        runningIssue(w, 1, "builder");
        runningIssue(w, 2, "builder");
        running(w, "architect", "ca");
        const s = await w.p.pass();
        assert.deepEqual(s.started, [12]);
    });
    test("with nothing running, personas take turns and a tie goes to the lowest number", async () => {
        const w = world({
            issues: [
                issue(10, ["stage:todo"]),
                issue(11, ["stage:todo"]),
                issue(12, ["stage:todo"]),
                issue(13, ["stage:todo"]),
                issue(14, ["stage:in-progress"])
            ],
            env: {PIPELINE_PARALLEL: "4", PIPELINE_PER_PERSONA: "0"}
        });
        const s = await w.p.pass();
        assert.deepEqual(s.started, [10, 14, 11, 12]);
    });
    test("the order and the persona limit work together", async () => {
        const w = world({
            issues: [
                issue(10, ["stage:todo"]),
                issue(11, ["stage:todo"]),
                issue(12, ["stage:in-progress"])
            ],
            env: {PIPELINE_PARALLEL: "4", PIPELINE_PER_PERSONA: "1"}
        });
        running(w, "architect", "ca");
        const s = await w.p.pass();
        assert.deepEqual(s.started, [12]);
        assert.ok(w.logs.includes("#10: waits, architect at its limit"));
    });
    test("a running spawn counts for its persona", async () => {
        const w = world({
            issues: [issue(10, ["stage:todo"]), issue(11, ["stage:in-progress"])],
            env: {PIPELINE_PARALLEL: "2", PIPELINE_PER_PERSONA: "0"}
        });
        running(w, "architect", "ca");
        const s = await w.p.pass();
        assert.deepEqual(s.started, [11]);
    });
});

/**
 * A plan comment whose Harness section holds the given lines.
 *
 * @param {string} lines - The lines under the Harness heading.
 * @returns {string} - The plan text.
 */
function planWith(lines) {
    return `**Implementation Plan**\n\n**Harness**\n\n${lines}\n\n**Blocked by**\n\nnone.\n`;
}

describe("the plan names the harness of a stage", () => {
    test("the plan's line starts the stage on its harness and model", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        w.github.planComment = async () => planWith("- review: codex gpt-5.5");
        w.profiles.reviewer = {...w.profiles.reviewer, codex: {present: true, loggedIn: true}};
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
        assert.equal(w.starts[0].harness, "codex");
        assert.equal(w.starts[0].model, "gpt-5.5");
        const session = w.state.issues[25].session;
        assert.equal(session.harness, "codex");
        assert.equal(session.model, "gpt-5.5");
        assert.equal(session.planned, true);
    });
    test("with no line for the stage, the setting decides", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"])],
            env: {PIPELINE_MODEL_BUILD: "claude-sonnet-5-5"}
        });
        w.github.planComment = async () => planWith("- review: codex gpt-5.5");
        await w.p.pass();
        assert.equal(w.starts[0].harness, "claude");
        assert.equal(w.starts[0].model, "claude-sonnet-5-5");
        assert.equal(w.state.issues[25].session.harness, "claude");
        assert.equal(w.state.issues[25].session.planned, false);
    });
    test("a missing login for the plan's harness is refused and the issue waits", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        w.github.planComment = async () => planWith("- review: codex gpt-5.5");
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.equal(w.starts.length, 0);
        assert.ok(
            w.logs.includes(
                "profile of reviewer is not logged in to codex: run npm run pipeline -- --login reviewer --harness codex"
            )
        );
        assert.ok(!w.state.issues[25].labels.includes("working"));
    });
    test("a bad line is refused by name and the issue waits", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        w.github.planComment = async () => planWith("- review: codx gpt-5.5");
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.ok(
            w.logs.includes(
                '#25: plan Harness line "review: codx gpt-5.5" is not <stage>: <harness> <model>'
            )
        );
    });
    test("while backed off the plan is not read and the issue waits", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        let reads = 0;
        w.github.planComment = async () => {
            reads++;
            return null;
        };
        w.state.sync.backoffUntil = new Date(w.clock.now() + 60000).toISOString();
        await w.p.pass();
        assert.equal(reads, 0);
        assert.equal(w.starts.length, 0);
    });
    test("a rate-limited read backs the loop off and the issue waits", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        const reset = new Date(w.clock.now() + 600000);
        w.github.planComment = async () => {
            throw new RateLimited("plan", reset);
        };
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.equal(w.state.sync.backoffUntil, reset.toISOString());
    });
    test("the plan stage never reads a plan", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        let reads = 0;
        w.github.planComment = async () => {
            reads++;
            return planWith("- plan: codex gpt-5.5");
        };
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
        assert.equal(reads, 0);
        assert.equal(w.starts[0].harness, "claude");
    });
    test("a spawn records its harness and model", async () => {
        const w = world();
        w.state.run.spawns.push({
            persona: "advocate",
            prompt: "File Y",
            issue: null,
            harness: null
        });
        await w.p.pass();
        assert.equal(w.state.run.sessions[0].harness, "claude");
        assert.equal(w.state.run.sessions[0].model, w.settings.modelFor("qa"));
    });
});
