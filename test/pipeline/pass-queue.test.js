// test/pipeline/pass-queue.test.js: the pass across the queue, the board and the scope.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {RateLimited} from "../../pipeline/lib/github.js";
import {end, issue, world} from "./pass-world.js";

const MIN = 60 * 1000;

describe("queued label writes", () => {
    test("a back-off that ends while a session runs: the queued +working goes first", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        let limited = true;
        w.github.label = async (/** @type {any} */ op) => {
            if (limited) {
                limited = false;
                throw new RateLimited("limit", new Date(w.clock.now() + MIN));
            }
            w.calls.push(["label", op]);
        };
        await w.p.pass();
        assert.equal(w.state.queued.length, 1, "+working waits in the queue");
        w.clock.advance(2 * MIN);
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {done: {done: {issue: 25, to: "stage:tests"}}}
        });
        await w.p.pass();
        const labels = w.calls.filter(c => c[0] === "label").map(c => c[1]);
        const added = labels.findIndex(op => op.add.includes("working"));
        const removed = labels.findIndex(op => op.remove.includes("working"));
        assert.ok(added >= 0 && removed > added, JSON.stringify(labels));
        assert.equal(w.state.queued.length, 0);
    });
    test("a write about an issue with a queued write queues behind it", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        let fail = true;
        w.github.label = async (/** @type {any} */ op) => {
            if (fail) {
                fail = false;
                throw new Error("HTTP 502");
            }
            w.calls.push(["label", op]);
        };
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {done: {done: {issue: 25, to: "stage:tests"}}}
        });
        await w.p.pass();
        assert.deepEqual(
            w.state.queued.map((/** @type {any} */ q) => [q.add, q.remove]),
            [
                [["stage:tests"], ["stage:todo"]],
                [[], ["working"]],
                [["working"], []]
            ],
            "the writes after the failed one wait behind it, in order"
        );
    });
    test("a working label on an issue with no session is removed at sync", async () => {
        const w = world({issues: [issue(25, ["stage:todo", "working"])]});
        const s = await w.p.pass();
        const labels = w.calls.filter(c => c[0] === "label").map(c => c[1]);
        assert.deepEqual(labels[0], {issue: 25, add: [], remove: ["working"]});
        assert.ok(w.logs.some((/** @type {string} */ l) => /#25: working with no session/.test(l)));
        assert.deepEqual(s.started, [25], "the issue is free again");
    });
});

describe("the scope with blocked issues", () => {
    test("a parked blocker inside an epic scope stops the run", async () => {
        const w = world({
            issues: [
                issue(25, ["stage:parked"], {body: "Part of #24"}),
                issue(26, ["stage:blocked"], {body: "Part of #24", blockedBy: [25]})
            ]
        });
        w.state.run.epic = 24;
        const s = await w.p.pass();
        assert.match(s.stopped ?? "", /nothing is due/);
    });
    test("a blocked issue with no blockers is logged once per sync", async () => {
        const w = world({issues: [issue(26, ["stage:blocked"])]});
        await w.p.pass();
        await w.p.pass();
        const lines = w.logs.filter((/** @type {string} */ l) => /#26: blocked by nothing/.test(l));
        assert.equal(lines.length, 1);
        w.clock.advance(11 * MIN);
        await w.p.pass();
        assert.equal(
            w.logs.filter((/** @type {string} */ l) => /#26: blocked by nothing/.test(l)).length,
            2
        );
    });
});

describe("the board", () => {
    test("the first sync of a run is a full one; a failed issue stays for the next", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        /** @type {any[]} */
        const syncs = [];
        w.board.sync = async (/** @type {any} */ o) => {
            syncs.push({all: o.all === true, issues: [...o.issues]});
            return {failed: syncs.length === 1 ? [25] : []};
        };
        await w.p.pass();
        w.clock.advance(11 * MIN);
        await w.p.pass();
        assert.equal(syncs[0].all, true);
        assert.equal(syncs[1].all, false);
        assert.ok(syncs[1].issues.includes(25), "the failed issue is synced again");
    });
    test("every PIPELINE_BOARD_FULL_EVERY-th sync is a full one", async () => {
        const w = world({
            issues: [issue(25, ["stage:done"], {state: "CLOSED"})],
            env: {PIPELINE_BOARD_FULL_EVERY: "2"}
        });
        /** @type {boolean[]} */
        const full = [];
        w.board.sync = async (/** @type {any} */ o) => {
            full.push(o.all === true);
            return {failed: [25]};
        };
        for (let i = 0; i < 3; i++) {
            await w.p.pass();
            w.clock.advance(11 * MIN);
        }
        assert.deepEqual(full, [true, false, true]);
    });
});
