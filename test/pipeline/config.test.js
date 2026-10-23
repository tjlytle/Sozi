import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {changedSettings, loadConfig, parseConfigText} from "../../pipeline/lib/config.js";

describe("pipeline settings", () => {
    test("defaults match the design", () => {
        const s = loadConfig({root: "/nonexistent", env: {}});
        assert.equal(s.parallel, 2);
        assert.equal(s.sessionMinutes, 45);
        assert.equal(s.syncMinutes, 10);
        assert.equal(s.maxTries, 3);
        assert.equal(s.rateLimitBackoffMinutes, 15);
        assert.equal(s.merge, "auto");
        assert.equal(s.plans, "auto");
        assert.equal(s.findings, "obvious");
        assert.equal(s.repo, "tjlytle/Sozi");
        assert.equal(s.modelFor("plan"), "claude-fable-5-1");
        assert.equal(s.modelFor("qa"), "claude-opus-5-5");
        assert.equal(s.harnessFor("build"), "claude");
    });
    test("file values override defaults and env overrides the file", () => {
        const file = parseConfigText(
            "# comment\nPIPELINE_PARALLEL=3\nPIPELINE_HARNESS_REVIEW=codex\n"
        );
        assert.deepEqual(file, {PIPELINE_PARALLEL: "3", PIPELINE_HARNESS_REVIEW: "codex"});
        const s = loadConfig({root: "/nonexistent", env: {PIPELINE_PARALLEL: "1"}, files: [file]});
        assert.equal(s.parallel, 1);
        assert.equal(s.harnessFor("review"), "codex");
        assert.equal(s.harnessFor("build"), "claude");
    });
    test("a bad value is an error naming the key", () => {
        assert.throws(
            () => loadConfig({root: "/nonexistent", env: {PIPELINE_MERGE: "maybe"}}),
            /PIPELINE_MERGE/
        );
        assert.throws(
            () => loadConfig({root: "/nonexistent", env: {PIPELINE_PLANS: "x"}}),
            /PIPELINE_PLANS/
        );
        assert.throws(
            () => loadConfig({root: "/nonexistent", env: {PIPELINE_FINDINGS: "x"}}),
            /PIPELINE_FINDINGS/
        );
        assert.throws(
            () => loadConfig({root: "/nonexistent", env: {PIPELINE_PARALLEL: "-1"}}),
            /PIPELINE_PARALLEL/
        );
        assert.throws(
            () => loadConfig({root: "/nonexistent", env: {PIPELINE_MAX_TRIES: "2.5"}}),
            /PIPELINE_MAX_TRIES/
        );
    });
    test("tests defaults to the QA model and the stage key beats the general key", () => {
        const s = loadConfig({
            root: "/nonexistent",
            env: {PIPELINE_MODEL: "m", PIPELINE_MODEL_PLAN: "p"}
        });
        assert.equal(s.modelFor("plan"), "p");
        assert.equal(s.modelFor("build"), "m");
        assert.equal(
            loadConfig({root: "/nonexistent", env: {}}).modelFor("tests"),
            "claude-opus-5-5"
        );
    });
    test("secrets: every file key that is not a PIPELINE_ setting, never the environment", () => {
        const file = {
            CLAUDE_CODE_OAUTH_TOKEN: "tok",
            NOTION_TOKEN: "n",
            PIPELINE_PARALLEL: "3",
            PIPELINE_EVIDENCE_TOKEN: "ev",
            PIPELINE_NOTION_PAGE: "page"
        };
        const s = loadConfig({root: "/nonexistent", env: {HOME: "/h"}, files: [file]});
        assert.deepEqual(s.secrets, {
            CLAUDE_CODE_OAUTH_TOKEN: "tok",
            NOTION_TOKEN: "n",
            PIPELINE_EVIDENCE_TOKEN: "ev",
            PIPELINE_NOTION_PAGE: "page"
        });
    });
    test("a decimal session budget is accepted; a negative one is not", () => {
        const s = loadConfig({root: "/nonexistent", env: {PIPELINE_SESSION_BUDGET_USD: "2.5"}});
        assert.equal(s.sessionBudgetUsd, 2.5);
        assert.throws(
            () => loadConfig({root: "/nonexistent", env: {PIPELINE_SESSION_BUDGET_USD: "-1"}}),
            /PIPELINE_SESSION_BUDGET_USD/
        );
    });
    test("profiles, per-persona limit and MCP allowlists", () => {
        const s = loadConfig({
            root: "/nonexistent",
            env: {PIPELINE_MCP_ARCHITECT: "mobbin, context7"}
        });
        assert.equal(s.profiles, "auto");
        assert.equal(s.perPersona, 1);
        assert.deepEqual(s.mcpFor("architect"), ["mobbin", "context7"]);
        assert.deepEqual(s.mcpFor("builder"), []);
    });
    test("PIPELINE_PROFILES takes auto or off", () => {
        assert.throws(
            () => loadConfig({root: "/nonexistent", env: {PIPELINE_PROFILES: "yes"}}),
            /PIPELINE_PROFILES must be one of auto\|off/
        );
        assert.equal(
            loadConfig({root: "/nonexistent", env: {PIPELINE_PROFILES: "off"}}).profiles,
            "off"
        );
    });
    test("values holds the effective settings but no secret", () => {
        const s = loadConfig({
            root: "/nonexistent",
            env: {PIPELINE_PARALLEL: "4"},
            files: [{PIPELINE_SYNC_MINUTES: "5", PIPELINE_EVIDENCE_TOKEN: "ev", OTHER: "x"}]
        });
        assert.equal(s.values.PIPELINE_PARALLEL, "4");
        assert.equal(s.values.PIPELINE_SYNC_MINUTES, "5");
        assert.equal(s.values.PIPELINE_MERGE, "auto");
        assert.equal("PIPELINE_EVIDENCE_TOKEN" in s.values, false);
        assert.equal("OTHER" in s.values, false);
    });
    test("changedSettings lists each changed setting as name: old -> new", () => {
        const before = loadConfig({root: "/nonexistent", env: {}, files: []});
        const after = loadConfig({
            root: "/nonexistent",
            env: {},
            files: [{PIPELINE_PARALLEL: "4", PIPELINE_HARNESS_REVIEW: "codex"}]
        });
        assert.deepEqual(changedSettings(before, after), [
            "setting PIPELINE_PARALLEL: 2 -> 4",
            "setting PIPELINE_HARNESS_REVIEW: (unset) -> codex"
        ]);
        assert.deepEqual(changedSettings(after, before), [
            "setting PIPELINE_PARALLEL: 4 -> 2",
            "setting PIPELINE_HARNESS_REVIEW: codex -> (unset)"
        ]);
    });
    test("changedSettings names a changed, added or removed secret without its value", () => {
        const before = loadConfig({
            root: "/nonexistent",
            env: {},
            files: [{CLAUDE_CODE_OAUTH_TOKEN: "old-tok", NOTION_TOKEN: "n"}]
        });
        const after = loadConfig({
            root: "/nonexistent",
            env: {},
            files: [{CLAUDE_CODE_OAUTH_TOKEN: "new-tok", PIPELINE_EVIDENCE_TOKEN: "ev"}]
        });
        const lines = changedSettings(before, after);
        assert.deepEqual(lines, [
            "secret CLAUDE_CODE_OAUTH_TOKEN changed",
            "secret PIPELINE_EVIDENCE_TOKEN changed",
            "secret NOTION_TOKEN changed"
        ]);
        assert.equal(/old-tok|new-tok|ev\b|\bn\b/.test(lines.join("\n")), false);
    });
    test("changedSettings marks the repository and the mint port as taking effect at restart", () => {
        const before = loadConfig({root: "/nonexistent", env: {}, files: []});
        const after = loadConfig({
            root: "/nonexistent",
            env: {},
            files: [{PIPELINE_REPO: "a/b", PIPELINE_MINT_PORT: "9000"}]
        });
        assert.deepEqual(changedSettings(before, after), [
            "setting PIPELINE_REPO: tjlytle/Sozi -> a/b (takes effect at restart)",
            "setting PIPELINE_MINT_PORT: 0 -> 9000 (takes effect at restart)"
        ]);
    });
    test("changedSettings returns nothing for an unchanged load", () => {
        const files = [{PIPELINE_PARALLEL: "3", CLAUDE_CODE_OAUTH_TOKEN: "t"}];
        assert.deepEqual(
            changedSettings(
                loadConfig({root: "/nonexistent", env: {}, files}),
                loadConfig({root: "/nonexistent", env: {}, files})
            ),
            []
        );
    });
    test("the repository's pipeline/config loads", () => {
        const s = loadConfig({root: fileURLToPath(new URL("../..", import.meta.url)), env: {}});
        assert.equal(s.image, "sozi-factory");
        assert.equal(s.human, "tjlytle");
    });
});
