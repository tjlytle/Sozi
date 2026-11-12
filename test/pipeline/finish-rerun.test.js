// test/pipeline/finish-rerun.test.js: judging a QA session that asked the loop to rerun its
// PR's CI run. Apart from finish.test.js, which judges done, wait, usage and carry.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {end, issue, world} from "./pass-world.js";

/**
 * Run one session of issue 25 at a stage to its end with a rerun request for run 7.
 *
 * @param {string} stage - The stage label the issue starts at.
 * @param {(w: any) => void} [setup] - Changes the fakes before the session ends.
 * @returns {Promise<any>} - The world after the judging pass.
 */
async function rerunSession(stage, setup = () => {}) {
    const w = world({issues: [issue(25, [stage])]});
    await w.p.pass();
    setup(w);
    end(w, w.state.issues[25].session.outbox, "c25", {requests: {rerun: {rerun: {run: 7}}}});
    await w.p.pass();
    return w;
}

describe("a rerun request", () => {
    test("an applied rerun keeps stage:qa, costs no try and counts one rerun", async () => {
        const w = await rerunSession("stage:qa");
        assert.equal(w.state.issues[25].stage, "stage:qa");
        assert.equal(w.state.issues[25].tries, 0);
        assert.equal(w.state.issues[25].reruns, 1);
        assert.ok(w.calls.some((/** @type {any[]} */ c) => c[0] === "rerunRun" && c[1] === 7));
        assert.ok(
            w.logs.some((/** @type {string} */ l) => /#25: CI rerun requested; no try/.test(l))
        );
    });
    test("a refused rerun counts a try", async () => {
        const w = await rerunSession("stage:qa", w => {
            w.github.runView = async () => ({
                databaseId: 7,
                status: "completed",
                createdAt: "2026-10-21T18:00:00Z",
                headBranch: "250-other",
                jobs: []
            });
        });
        assert.equal(w.state.issues[25].tries, 1);
        assert.equal(w.state.issues[25].reruns ?? 0, 0);
        assert.ok(!w.calls.some((/** @type {any[]} */ c) => c[0] === "rerunRun"));
    });
    test("a rerun from a review session is refused and counts a try", async () => {
        const w = await rerunSession("stage:review");
        assert.equal(w.state.issues[25].stage, "stage:review");
        assert.equal(w.state.issues[25].tries, 1);
        assert.ok(!w.calls.some((/** @type {any[]} */ c) => c[0] === "rerunRun"));
    });
});
