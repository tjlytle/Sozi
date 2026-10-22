// test/pipeline/pipeline.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {emptyState, applyIssue} from "../../pipeline/lib/state.js";
import {main} from "../../bin/pipeline.js";

const issue = (/** @type {number} */ number, /** @type {string[]} */ labels) => ({
    number,
    title: `t${number}`,
    labels,
    state: /** @type {"OPEN"} */ ("OPEN"),
    body: "",
    updatedAt: "2026-10-21T00:00:00Z"
});

describe("bin/pipeline.js", () => {
    test("--status reads the state file and prints sessions and queues", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-"));
        const state = emptyState();
        applyIssue(state, issue(25, ["stage:in-progress"]));
        state.issues[25].session = {container: "c25", started: "t", stage: "build", outbox: "o"};
        state.queued.push({issue: 25, add: ["stage:review"], remove: []});
        fs.mkdirSync(path.join(root, "var", "pipeline"), {recursive: true});
        fs.writeFileSync(path.join(root, "var", "pipeline", "state.json"), JSON.stringify(state));
        let text = "";
        const code = await main(["--status"], {root, env: {}, out: t => (text += t)});
        assert.equal(code, 0);
        assert.match(text, /#25 build: c25/);
        assert.match(text, /queued labels: 1/);
    });
    test("an unknown argument prints the usage", async () => {
        let text = "";
        assert.equal(await main(["nope"], {env: {}, err: t => (text += t)}), 2);
        assert.match(text, /usage/);
    });
});
