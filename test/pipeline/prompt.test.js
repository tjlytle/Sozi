import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {loadConfig} from "../../pipeline/lib/config.js";
import {settingsBlock, renderPrompt} from "../../pipeline/lib/prompt.js";

describe("the run settings block", () => {
    const s = loadConfig({root: "/nonexistent", env: {}});
    test("tells the session the policy in words", () => {
        const b = settingsBlock(s, {issue: 25, stage: "build", epic: 24, until: null});
        assert.match(b, /^## Run settings/);
        assert.match(b, /Issue: #25/);
        assert.match(b, /Merge: auto .*QA merges/);
        assert.match(b, /Plans: auto/);
        assert.match(b, /Findings: obvious \(file every finding as its own issue; an obvious one/);
        assert.doesNotMatch(b, /fix the obvious findings yourself/);
        assert.match(b, /Epic: #24/);
        assert.match(b, /Outbox: \/outbox/);
    });
    test("review policy and until line", () => {
        const r = loadConfig({root: "/nonexistent", env: {PIPELINE_MERGE: "review"}});
        const b = settingsBlock(r, {issue: 1, stage: "qa", epic: null, until: "review"});
        assert.match(b, /Merge: review \(stop at approval; a person merges\)/);
        assert.match(b, /Until: review/);
        assert.doesNotMatch(b, /Epic:/);
    });
    test("findings triage files every finding with the triage label", () => {
        const t = loadConfig({root: "/nonexistent", env: {PIPELINE_FINDINGS: "triage"}});
        const b = settingsBlock(t, {issue: 1, stage: "qa", epic: null, until: null});
        assert.match(
            b,
            /Findings: triage \(file every finding as its own issue with the triage label\)/
        );
    });
    test("renders a template with the block on top and {N} replaced", () => {
        const out = renderPrompt("Issue #{N} is yours.", s, {
            issue: 25,
            stage: "build",
            epic: null,
            until: null
        });
        assert.match(out, /^## Run settings[\s\S]*\n\nIssue #25 is yours\.$/);
    });
});
