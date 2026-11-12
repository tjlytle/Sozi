/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// test/pipeline/rerun.test.js: when the loop reruns a PR's CI run, and how.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {RERUN_LIMIT, STUCK_AFTER_MS, applyRerun, rerunAction} from "../../pipeline/lib/rerun.js";

const now = Date.parse("2026-11-11T21:24:00Z");
const minutes = (/** @type {number} */ m) => new Date(now - m * 60 * 1000).toISOString();

/**
 * A run as `runView` returns it: stuck queued on issue 430's branch unless changed.
 *
 * @param {object} [extra] - Fields that replace the defaults.
 * @returns {any} - The run.
 */
function run(extra = {}) {
    return {
        databaseId: 43095929857,
        status: "queued",
        conclusion: "",
        createdAt: minutes(59),
        headBranch: "430-stuck-run",
        jobs: [],
        ...extra
    };
}

const started = [{databaseId: 43095929999, status: "in_progress", createdAt: minutes(6)}];

/**
 * Decide on a run against issue 430 at `now`.
 *
 * @param {any} r - The run.
 * @param {any[]} [newer] - The recent runs.
 * @returns {any} - The decision.
 */
const decide = (r, newer = started) =>
    rerunAction({run: r, newer, issue: 430, now, stuckAfterMs: STUCK_AFTER_MS});

describe("rerunAction", () => {
    test("a run queued with no jobs while a newer one started is cancelled and rerun", () => {
        assert.deepEqual(decide(run()), {action: "cancel-rerun"});
    });
    test("a run queued 19 minutes is not stuck yet", () => {
        assert.ok("refused" in decide(run({createdAt: minutes(19)}), [])); // no newer either
        const young = decide(run({createdAt: minutes(19)}), [
            {databaseId: 1, status: "in_progress", createdAt: minutes(1)}
        ]);
        assert.match(young.refused, /20 minutes|not stuck/);
    });
    test("a queued run that has jobs is refused", () => {
        assert.ok("refused" in decide(run({jobs: [{name: "check"}]})));
    });
    test("when every newer run is queued too, GitHub is backed up and the run is left", () => {
        const queued = [{databaseId: 2, status: "queued", createdAt: minutes(5)}];
        assert.match(decide(run(), queued).refused, /newer/);
    });
    test("an older run that started does not count as newer", () => {
        const older = [{databaseId: 3, status: "completed", createdAt: minutes(90)}];
        assert.ok("refused" in decide(run(), older));
    });
    test("a run on another issue's branch is refused", () => {
        assert.match(decide(run({headBranch: "4300-x"})).refused, /branch/);
    });
    test("a completed run is rerun", () => {
        assert.deepEqual(decide(run({status: "completed", conclusion: "failure"})), {
            action: "rerun"
        });
    });
    test("a run in progress is refused", () => {
        assert.ok("refused" in decide(run({status: "in_progress", jobs: [{name: "check"}]})));
    });
});

/**
 * A pass context over a fake GitHub that records every call, for issue 430.
 *
 * @param {{views?: any[], stage?: string, reruns?: number, fail?: string}} [options] - What
 *   runView returns, in order (the last repeats); the session's stage; reruns so far; a call
 *   that throws.
 * @returns {any} - The context, with `calls` and `logs`.
 */
function context({views = [run()], stage = "qa", reruns = 0, fail} = {}) {
    /** @type {any[]} */
    const calls = [];
    /** @type {string[]} */
    const logs = [];
    /**
     * Record a call, throwing when it is the one to fail.
     * @param {string} name - The call.
     * @param {any} [arg] - Its argument.
     */
    const call = (name, arg) => {
        calls.push(arg === undefined ? [name] : [name, arg]);
        if (fail === name) {
            throw new Error(`${name} failed (1): HTTP 403`);
        }
    };
    const github = {
        runView: async (/** @type {number} */ id) => {
            call("runView", id);
            return views.length > 1 ? views.shift() : views[0];
        },
        recentRuns: async () => {
            call("recentRuns");
            return started;
        },
        cancelRun: async (/** @type {number} */ id) => call("cancelRun", id),
        rerunRun: async (/** @type {number} */ id) => call("rerunRun", id)
    };
    const record = {stage: `stage:${stage}`, session: {stage}, reruns, labels: []};
    return {
        calls,
        logs,
        state: {issues: {430: record}},
        github,
        clock: {now: () => now},
        log: (/** @type {string} */ line) => logs.push(line)
    };
}

const request = {kind: /** @type {"rerun"} */ ("rerun"), run: 43095929857};
const sleep = async () => {};

describe("applyRerun", () => {
    test("it cancels, polls until the run completes, then reruns, and counts it", async () => {
        const ctx = context({
            views: [run(), run({status: "in_progress"}), run({status: "completed"})]
        });
        /** @type {number[]} */
        const naps = [];
        const acted = await applyRerun(ctx, 430, request, {sleep: async ms => void naps.push(ms)});
        assert.equal(acted, true);
        const id = request.run;
        assert.deepEqual(ctx.calls, [
            ["runView", id],
            ["recentRuns"],
            ["cancelRun", id],
            ["runView", id],
            ["runView", id],
            ["rerunRun", id]
        ]);
        assert.deepEqual(naps, [5000]);
        assert.equal(ctx.state.issues[430].reruns, 1);
    });
    test("a completed run is rerun without a cancel", async () => {
        const ctx = context({views: [run({status: "completed", conclusion: "failure"})]});
        assert.equal(await applyRerun(ctx, 430, request, {sleep}), true);
        assert.deepEqual(ctx.calls.at(-1), ["rerunRun", request.run]);
        assert.ok(!ctx.calls.some((/** @type {any[]} */ c) => c[0] === "cancelRun"));
    });
    test("a cancel that never completes in 60 s is not followed by a rerun", async () => {
        const ctx = context({views: [run(), run({status: "in_progress"})]});
        /** @type {number[]} */
        const naps = [];
        const acted = await applyRerun(ctx, 430, request, {sleep: async ms => void naps.push(ms)});
        assert.equal(acted, false);
        assert.ok(naps.reduce((a, b) => a + b, 0) <= 60000);
        assert.ok(!ctx.calls.some((/** @type {any[]} */ c) => c[0] === "rerunRun"));
        assert.equal(ctx.state.issues[430].reruns, 0);
    });
    test(`a rerun past the ${RERUN_LIMIT} a visit allows is refused before GitHub is asked`, async () => {
        const ctx = context({reruns: RERUN_LIMIT});
        assert.equal(await applyRerun(ctx, 430, request, {sleep}), false);
        assert.deepEqual(ctx.calls, []);
        assert.ok(ctx.logs.some((/** @type {string} */ l) => /refused rerun.*3/.test(l)));
    });
    test("a request from a review session is refused", async () => {
        const ctx = context({stage: "review"});
        assert.equal(await applyRerun(ctx, 430, request, {sleep}), false);
        assert.deepEqual(ctx.calls, []);
        assert.ok(ctx.logs.some((/** @type {string} */ l) => /refused rerun.*stage:qa/.test(l)));
    });
    test("a refused decision is logged with its reason", async () => {
        const ctx = context({views: [run({headBranch: "4300-x"})]});
        assert.equal(await applyRerun(ctx, 430, request, {sleep}), false);
        assert.ok(ctx.logs.some((/** @type {string} */ l) => /refused rerun.*branch/.test(l)));
    });
    test("a gh failure is logged, nothing throws, and nothing is counted", async () => {
        const ctx = context({fail: "cancelRun"});
        assert.equal(await applyRerun(ctx, 430, request, {sleep}), false);
        assert.ok(ctx.logs.some((/** @type {string} */ l) => /rerun.*HTTP 403/.test(l)));
        assert.equal(ctx.state.issues[430].reruns, 0);
    });
});
