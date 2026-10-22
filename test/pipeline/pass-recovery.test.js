// test/pipeline/pass-recovery.test.js: the pass when sessions, GitHub or the loop fail.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {RateLimited} from "../../pipeline/lib/github.js";
import {end, issue, world} from "./pass-world.js";

const MIN = 60 * 1000;

describe("unverified sessions", () => {
    test("a session stopped at the cap does not move its issue; a try", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {done: {done: {issue: 25, to: "stage:tests"}}}
        });
        w.containers.c25 = "running";
        w.clock.advance(46 * MIN);
        await w.p.pass();
        assert.equal(w.state.issues[25].stage, "stage:todo");
        assert.equal(w.state.issues[25].tries, 1);
    });
    test("a gone container with no result does not move its issue; a try", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        fs.writeFileSync(
            path.join(w.state.issues[25].session.outbox, "req-done.json"),
            JSON.stringify({done: {issue: 25, to: "stage:tests"}})
        );
        delete w.containers.c25;
        await w.p.pass();
        assert.equal(w.state.issues[25].stage, "stage:todo");
        assert.equal(w.state.issues[25].tries, 1);
    });
    test("docker failing leaves the session alone", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        w.containers.c25 = "unknown";
        w.clock.advance(46 * MIN);
        await w.p.pass();
        assert.ok(w.state.issues[25].session);
        assert.equal(w.state.issues[25].tries, 0);
    });
    test("a session judged once is not judged again", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {done: {done: {issue: 25, to: "stage:tests"}}}
        });
        w.state.issues[25].session.judged = true;
        const s = await w.p.pass();
        assert.equal(w.state.issues[25].stage, "stage:todo");
        assert.equal(w.state.issues[25].tries, 0);
        assert.deepEqual(s.finished, [25]);
    });
});

describe("parking and waking", () => {
    test("a lost parking comment is queued and written at the next sync", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])], env: {PIPELINE_MAX_TRIES: "1"}});
        let fail = true;
        w.github.comment = async (/** @type {any[]} */ ...a) => {
            if (fail) {
                fail = false;
                throw new Error("HTTP 502");
            }
            w.calls.push(["comment", ...a]);
        };
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {exit: 1});
        await w.p.pass();
        assert.equal(w.state.issues[25].stage, "stage:parked");
        assert.equal(w.state.issues[25].parkedAt, new Date(w.clock.now()).toISOString());
        assert.ok(w.state.queued.some((/** @type {any} */ q) => q.comment?.issue === 25));
        w.clock.advance(11 * MIN);
        await w.p.pass();
        assert.ok(w.calls.some(c => c[0] === "comment" && /parking/.test(c[3])));
        assert.equal(w.state.queued.length, 0);
    });
    test("while backed off: no label read, and the parking comment waits", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])], env: {PIPELINE_MAX_TRIES: "1"}});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {exit: 1});
        w.state.sync.backoffUntil = new Date(w.clock.now() + MIN).toISOString();
        await w.p.pass();
        assert.ok(!w.calls.some(c => c[0] === "labelsOf" || c[0] === "comment"));
        assert.ok(w.state.queued.some((/** @type {any} */ q) => q.comment?.issue === 25));
    });
    test("a person's comment from before the loop parked does not wake it", async () => {
        const w = world({issues: [issue(25, ["stage:parked"])]});
        w.state.issues[25].parkedAt = "2026-10-21T18:00:00Z";
        w.github.lastHumanCommentAt = async () => "2026-10-21T17:00:00Z";
        w.issues[0].updatedAt = "2026-10-21T18:00:05Z";
        await w.p.pass();
        assert.equal(w.state.issues[25].stage, "stage:parked");
    });
    test("a person's comment after the loop parked wakes it", async () => {
        const w = world({issues: [issue(25, ["stage:parked"])]});
        w.state.issues[25].parkedAt = "2026-10-21T18:00:00Z";
        w.state.issues[25].parkedFrom = "stage:review";
        w.github.lastHumanCommentAt = async () => "2026-10-21T18:30:00Z";
        w.issues[0].updatedAt = "2026-10-21T18:30:00Z";
        const s = await w.p.pass();
        assert.deepEqual(s.moved, [[25, "stage:parked", "stage:review"]]);
    });
});

describe("GitHub failures", () => {
    test("a queued label op GitHub refuses goes to the dead letters; the sync goes on", async () => {
        const w = world({issues: [issue(25, ["stage:done"], {state: "CLOSED"})]});
        w.state.queued.push({issue: 99, add: ["triage"], remove: []});
        w.github.label = async () => {
            throw new Error("HTTP 404: no such issue");
        };
        await w.p.pass();
        assert.equal(w.state.queued.length, 0);
        assert.equal(w.state.deadLetters.length, 1);
        assert.match(w.state.deadLetters[0].error, /404/);
        assert.notEqual(w.state.sync.last, null);
    });
    test("a first sync that fails does not stop a fresh run", async () => {
        const w = world({issues: [issue(25, ["stage:done"], {state: "CLOSED"})]});
        w.github.searchIssues = async () => {
            throw new Error("network down");
        };
        const s = await w.p.pass();
        assert.equal(s.stopped, null);
    });
    test("a rate-limited working label is queued and the session still starts", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        w.github.label = async () => {
            throw new RateLimited("limit", new Date(w.clock.now() + MIN));
        };
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
        assert.deepEqual(w.state.queued, [{issue: 25, add: ["working"], remove: []}]);
        assert.notEqual(w.state.sync.backoffUntil, null);
    });
});

describe("labels and scope", () => {
    test("finish removes the working label", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {done: {done: {issue: 25, to: "stage:done"}}}
        });
        await w.p.pass();
        assert.ok(w.calls.some(c => c[0] === "label" && c[1].remove.includes("working")));
        assert.ok(!w.state.issues[25].labels.includes("working"));
    });
    test("a stage moved by hand clears waiting, and the issue starts", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {requests: {note: {note: "waiting"}}});
        await w.p.pass();
        assert.equal(w.state.issues[25].waiting, true);
        w.issues[0].labels = ["stage:tests"];
        w.clock.advance(11 * MIN);
        const s = await w.p.pass();
        assert.equal(w.state.issues[25].waiting, false);
        assert.deepEqual(s.started, [25]);
    });
    test("--epic: an issue outside the epic is neither started nor unblocked", async () => {
        const w = world({
            issues: [
                issue(25, ["stage:todo"], {body: "Part of #24"}),
                issue(26, ["stage:todo"]),
                issue(29, ["stage:done"], {state: "CLOSED"}),
                issue(30, ["stage:blocked"], {blockedBy: [29]})
            ]
        });
        w.state.run.epic = 24;
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
        assert.equal(w.state.issues[30].stage, "stage:blocked");
    });
});
