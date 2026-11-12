// test/pipeline/stage-branch.test.js: which branch pipeline/stage.sh checks out when the
// issue's PR head is known (PIPELINE_BRANCH) and when more than one issue branch exists (#100).
import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {cleanUp, result, runStage, world} from "./stage-world.js";

after(cleanUp);

/**
 * Name the branch the work checkout ended up on.
 * @param {Record<string, string>} env - The environment.
 * @returns {string} - The branch name.
 */
const branchOf = env =>
    execFileSync("git", ["-C", env.WORK, "rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf8"
    }).trim();

/**
 * Whether the fake harness ran in a world.
 * @param {string} outbox - The outbox.
 * @returns {boolean} - True when it was called.
 */
const harnessRan = outbox => fs.existsSync(path.join(outbox, "calls"));

describe("the branch the stage runner checks out", () => {
    test("two issue branches and no PR head: the harness never runs, the names are reported", () => {
        const w = world(false, ["25-a", "25-b"]);
        runStage(w.env);
        assert.equal(harnessRan(w.outbox), false);
        const log = fs.readFileSync(path.join(w.outbox, "log"), "utf8");
        assert.match(log, /^== branch: 2 branches match 25-\*: 25-a, 25-b$/m);
        assert.doesNotMatch(log, /== node_modules/);
        assert.deepEqual(result(w.outbox).branches, ["25-a", "25-b"]);
    });
    test("two issue branches and PIPELINE_BRANCH naming the second: that one is worked on", () => {
        const w = world(false, ["25-a", "25-b"]);
        runStage({...w.env, PIPELINE_BRANCH: "25-b"});
        assert.equal(branchOf(w.env), "25-b");
        assert.equal(harnessRan(w.outbox), true);
        assert.equal(result(w.outbox).branches, undefined);
    });
    test("a PIPELINE_BRANCH the remote does not have falls back to the one issue branch", () => {
        const w = world(true);
        runStage({...w.env, PIPELINE_BRANCH: "25-gone"});
        assert.equal(branchOf(w.env), "25-slug");
        assert.equal(harnessRan(w.outbox), true);
    });
    test("a PIPELINE_BRANCH outside the issue pattern is still used", () => {
        const w = world(true, ["feature-x"]);
        runStage({...w.env, PIPELINE_BRANCH: "feature-x"});
        assert.equal(branchOf(w.env), "feature-x");
    });
});
