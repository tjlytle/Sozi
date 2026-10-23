// test/pipeline/pass.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {parseUntil} from "../../bin/pipeline.js";
import {end, issue, world} from "./pass-world.js";

describe("a pass", () => {
    test("starts due issues up to the parallel limit, as working", async () => {
        const w = world({
            issues: [
                issue(25, ["stage:todo"]),
                issue(26, ["stage:in-progress"]),
                issue(27, ["stage:todo"])
            ]
        });
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25, 26]);
        assert.deepEqual(
            w.calls.filter(c => c[0] === "label").map(c => c[1]),
            [
                {issue: 25, add: ["working"], remove: []},
                {issue: 26, add: ["working"], remove: []}
            ]
        );
    });
    test("a finished session with a done request moves the issue and frees the slot", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        fs.writeFileSync(
            path.join(outbox, "result.json"),
            JSON.stringify({
                exit: 0,
                session: "s",
                usage: {tokensIn: 10, tokensOut: 5, costUsd: 0.01, turns: 2, status: "ok"},
                changed: [],
                commits: [],
                resumes: 0
            })
        );
        fs.writeFileSync(
            path.join(outbox, "req-done.json"),
            JSON.stringify({done: {issue: 25, to: "stage:tests"}})
        );
        w.containers.c25 = "exited";
        const s = await w.p.pass();
        assert.deepEqual(s.moved, [[25, "stage:todo", "stage:tests"]]);
        assert.equal(w.state.issues[25].stage, "stage:tests");
        assert.equal(w.state.run.tokens, 15);
        assert.deepEqual(s.started, [25], "the next stage starts in the same pass");
    });
    test("no done and no label move: a try; three tries park with a comment", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        for (let i = 0; i < 3; i++) {
            await w.p.pass();
            fs.writeFileSync(
                path.join(w.state.issues[25].session.outbox, "result.json"),
                JSON.stringify({
                    exit: 1,
                    session: "s",
                    usage: {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 0, status: "error"},
                    changed: [],
                    commits: [],
                    resumes: 0
                })
            );
            w.containers.c25 = "exited";
            await w.p.pass();
        }
        assert.ok(w.calls.some(c => c[0] === "comment" && /parking/.test(c[3])));
        assert.equal(w.state.issues[25].stage, "stage:parked");
    });
    test("a running session past the cap is stopped and counts as a try", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        w.clock.advance(46 * 60 * 1000);
        await w.p.pass();
        assert.equal(w.state.issues[25].tries, 1);
        assert.equal(w.state.issues[25].session, null);
    });
    test("--until: no starts after it, stop once sessions finish", async () => {
        const w = world({
            issues: [issue(25, ["stage:todo"]), issue(26, ["stage:todo"])],
            env: {PIPELINE_PARALLEL: "1"}
        });
        w.state.run.until = new Date(w.clock.now() + 1000).toISOString();
        await w.p.pass();
        w.clock.advance(2000);
        let s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.equal(s.stopped, null, "25 still runs");
        fs.writeFileSync(
            path.join(w.state.issues[25].session.outbox, "result.json"),
            JSON.stringify({
                exit: 0,
                session: "s",
                usage: {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 1, status: "ok"},
                changed: [],
                commits: [],
                resumes: 0
            })
        );
        fs.writeFileSync(
            path.join(w.state.issues[25].session.outbox, "req-done.json"),
            JSON.stringify({done: {issue: 25, to: "stage:tests"}})
        );
        w.containers.c25 = "exited";
        s = await w.p.pass();
        assert.match(s.stopped, /until/);
    });
    test("quiet scope stops the run", async () => {
        const w = world({
            issues: [issue(25, ["stage:done"], {state: "CLOSED"}), issue(31, ["triage"])]
        });
        const s = await w.p.pass();
        assert.match(s.stopped, /nothing is due/);
    });
    test("a refused request is logged and not applied", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        fs.writeFileSync(
            path.join(outbox, "result.json"),
            JSON.stringify({
                exit: 0,
                session: "s",
                usage: {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 1, status: "ok"},
                changed: [],
                commits: [],
                resumes: 0
            })
        );
        fs.writeFileSync(
            path.join(outbox, "req-1.json"),
            JSON.stringify({label: {issue: 25, add: ["stage:done"]}})
        );
        w.containers.c25 = "exited";
        await w.p.pass();
        assert.ok(!w.calls.some(c => c[0] === "label" && c[1].add.includes("stage:done")));
        assert.ok(w.logs.some(l => /refused req-1\.json/.test(l)));
    });
    test("a rate-limited label change is queued and applied on the next sync", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        fs.writeFileSync(
            path.join(outbox, "result.json"),
            JSON.stringify({
                exit: 0,
                session: "s",
                usage: {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 1, status: "ok"},
                changed: [],
                commits: [],
                resumes: 0
            })
        );
        fs.writeFileSync(
            path.join(outbox, "req-done.json"),
            JSON.stringify({done: {issue: 25, to: "stage:tests"}})
        );
        w.containers.c25 = "exited";
        w.state.sync.backoffUntil = new Date(w.clock.now() + 60000).toISOString();
        await w.p.pass();
        assert.equal(w.state.queued.length >= 1, true);
        assert.equal(
            w.state.issues[25].stage,
            "stage:tests",
            "state moves even while GitHub waits"
        );
        w.clock.advance(11 * 60 * 1000);
        await w.p.pass();
        assert.equal(w.state.queued.length, 0);
    });
    test("a restart adopts a still-running container instead of starting a second", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.equal(w.calls.filter(c => c[0] === "start").length, 1);
    });

    test("a session that waits for a person is not a try and does not restart", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {wait: {wait: "plan posted for #25; waiting for review"}}
        });
        const s = await w.p.pass();
        assert.equal(w.state.issues[25].tries, 0);
        assert.equal(w.state.issues[25].stage, "stage:todo");
        assert.deepEqual(s.started, []);
        assert.ok(w.logs.some(l => /waiting for review/.test(l)));
        assert.match(s.stopped ?? "", /nothing is due/, "a waiting issue is not due");
    });
    test("a crashed outside pass is a try even with a done request", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {
            hooks: "error",
            requests: {done: {done: {issue: 25, to: "stage:tests"}}}
        });
        await w.p.pass();
        assert.equal(w.state.issues[25].stage, "stage:todo");
        assert.equal(w.state.issues[25].tries, 1);
        assert.ok(w.logs.some(l => /checks crashed/.test(l)));
    });
    test("a spawn request starts a spawn session with spawn.md rendered", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {
                done: {done: {issue: 25, to: "stage:review"}},
                spawn: {spawn: {persona: "advocate", prompt: "File an issue about X"}}
            }
        });
        await w.p.pass();
        const spawn = w.outboxes.find((/** @type {any} */ o) => o.stage === "spawn");
        assert.ok(spawn, "a spawn outbox was prepared");
        assert.match(spawn.prompt, /You are the \*\*advocate\*\*/);
        assert.match(spawn.prompt, /File an issue about X/);
        assert.match(spawn.prompt, /- Stage: spawn/);
        assert.doesNotMatch(spawn.prompt, /\{PERSONA\}|- Issue: #0/);
        assert.equal(w.state.run.sessions.length, 1);
        assert.equal(w.state.run.spawns.length, 0);
        assert.ok(w.calls.some(c => c[0] === "start" && c[2] === "spawn"));
        w.containers.c0 = "exited";
        await w.p.pass();
        assert.equal(w.state.run.sessions.length, 0, "the spawn session is reaped");
    });
    test("an unblocked issue moves to stage:tests and starts", async () => {
        const w = world({
            issues: [
                issue(29, ["stage:done"], {state: "CLOSED"}),
                issue(30, ["stage:blocked"], {blockedBy: [29]})
            ]
        });
        const s = await w.p.pass();
        assert.deepEqual(s.moved, [[30, "stage:blocked", "stage:tests"]]);
        assert.deepEqual(s.started, [30]);
        assert.deepEqual(
            w.calls.find(c => c[0] === "start"),
            ["start", 30, "tests"]
        );
        assert.ok(
            w.calls.some(
                c =>
                    c[0] === "label" &&
                    c[1].add.includes("stage:tests") &&
                    c[1].remove.includes("stage:blocked")
            )
        );
    });
});

describe("persona profiles at start", () => {
    test("a stage starts with its persona's profile", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        assert.equal(w.starts.length, 1);
        assert.equal(w.starts[0].persona, "builder");
        assert.equal(w.starts[0].profile, true);
        assert.equal(w.state.issues[25].session.persona, "builder");
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

describe("waking", () => {
    test("a parked issue whose newest comment is a person's goes back and starts", async () => {
        const w = world({issues: [issue(25, ["stage:parked"])]});
        w.github.lastHumanCommentAt = async () => "2026-10-21T17:00:00Z";
        w.issues[0].updatedAt = "2026-10-21T18:00:00Z";
        const s = await w.p.pass();
        assert.deepEqual(s.moved, [[25, "stage:parked", "stage:todo"]]);
        assert.deepEqual(s.started, [25]);
    });
});

describe("unblocking", () => {
    test("moves an unblocked issue even when no slot is free", async () => {
        const w = world({
            issues: [
                issue(25, ["stage:todo"]),
                issue(29, ["stage:done"], {state: "CLOSED"}),
                issue(30, ["stage:blocked"], {blockedBy: [29]})
            ],
            env: {PIPELINE_PARALLEL: "1"}
        });
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
        assert.equal(w.state.issues[30].stage, "stage:tests");
    });
});

describe("parseUntil", () => {
    const now = new Date(2026, 9, 21, 19, 0, 0);
    test("a duration counts from now", () => {
        assert.equal(parseUntil("6h", now).getTime(), now.getTime() + 6 * 3600 * 1000);
        assert.equal(parseUntil("90m", now).getTime(), now.getTime() + 90 * 60 * 1000);
    });
    test("a time of day is the next one", () => {
        assert.equal(parseUntil("07:00", now).getTime(), new Date(2026, 9, 22, 7, 0).getTime());
        assert.equal(parseUntil("20:30", now).getTime(), new Date(2026, 9, 21, 20, 30).getTime());
        assert.throws(() => parseUntil("soon", now), /--until/);
    });
});
