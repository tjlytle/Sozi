/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// test/pipeline/github-runs.test.js: the Actions run calls the loop makes as ops.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {calls, json, make} from "./github-world.js";

describe("github runs", () => {
    test("runView reads one run with its jobs as ops", async () => {
        const run = {databaseId: 7, status: "queued", jobs: []};
        const gh = make([json(run)]);
        assert.deepEqual(await gh.runView(7), run);
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "run",
            "view",
            "7",
            "-R",
            "tjlytle/Sozi",
            "--json",
            "databaseId,status,conclusion,createdAt,headBranch,jobs"
        ]);
    });
    test("recentRuns lists the newest 30 runs in the repository", async () => {
        const gh = make([json([{databaseId: 8, status: "in_progress"}])]);
        assert.deepEqual(await gh.recentRuns(), [{databaseId: 8, status: "in_progress"}]);
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "run",
            "list",
            "-R",
            "tjlytle/Sozi",
            "--limit",
            "30",
            "--json",
            "databaseId,status,createdAt"
        ]);
    });
    test("cancelRun and rerunRun act on the run as ops", async () => {
        const gh = make([{}, {}]);
        await gh.cancelRun(7);
        await gh.rerunRun(7);
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "run",
            "cancel",
            "7",
            "-R",
            "tjlytle/Sozi"
        ]);
        assert.deepEqual(calls[1].cmd, ["gh-as", "ops", "run", "rerun", "7", "-R", "tjlytle/Sozi"]);
    });
    test("a refused rerun throws", async () => {
        const gh = make([{code: 1, stderr: "run 7 cannot be rerun"}]);
        await assert.rejects(gh.rerunRun(7), /cannot be rerun/);
    });
});
