import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {loadConfig, parseConfigText} from "../../pipeline/lib/config.js";

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
    test("the repository's pipeline/config loads", () => {
        const s = loadConfig({root: fileURLToPath(new URL("../..", import.meta.url)), env: {}});
        assert.equal(s.image, "sozi-factory");
        assert.equal(s.human, "tjlytle");
    });
});
