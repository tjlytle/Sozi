import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    emptyState,
    applyIssue,
    stageOf,
    promptFor,
    dueIssues,
    scope,
    isQuiet,
    recordTry,
    park,
    wake,
    queueLabel,
    takeQueuedLabels,
    ceiling,
    setStage,
    addUsage,
    loadState,
    saveState
} from "../../pipeline/lib/state.js";
import {loadConfig} from "../../pipeline/lib/config.js";

const settings = loadConfig({
    root: "/nonexistent",
    env: {PIPELINE_SOFT_TOKENS: "100", PIPELINE_HARD_TOKENS: "200"}
});
/** @type {(number: number, labels: string[], extra?: object) => any} */
const issue = (number, labels, extra = {}) => ({
    number,
    title: `t${number}`,
    labels,
    state: "OPEN",
    body: "",
    updatedAt: "2026-10-21T00:00:00Z",
    ...extra
});

describe("state", () => {
    test("labels map to stages and prompts", () => {
        assert.equal(stageOf(["enhancement", "stage:review"]), "stage:review");
        assert.equal(stageOf(["idea"]), null);
        assert.equal(promptFor("stage:todo"), "plan");
        assert.equal(promptFor("stage:tests"), "tests");
        assert.equal(promptFor("stage:blocked"), null);
    });
    test("an issue is added with its epic and blockers", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:blocked"], {body: "Part of #24.\n", blockedBy: [28]}));
        assert.equal(s.issues[25].epic, 24);
        assert.deepEqual(s.issues[25].blockers, [28]);
        assert.equal(s.issues[25].stage, "stage:blocked");
    });
    test("due issues: a prompt, no session, blockers closed, by number", () => {
        const s = emptyState();
        applyIssue(s, issue(30, ["stage:todo"]));
        applyIssue(s, issue(25, ["stage:in-progress"]));
        applyIssue(s, issue(26, ["stage:blocked"], {blockedBy: [28]}));
        applyIssue(s, issue(28, ["stage:done"], {state: "CLOSED"}));
        applyIssue(s, issue(27, ["stage:blocked"], {blockedBy: [25]}));
        s.issues[30].session = {container: "x"};
        assert.deepEqual(dueIssues(s, settings, new Date()), [25, 26]);
    });
    test("scope follows the epic marker; quiet means nothing is due and nothing runs", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:done"], {body: "Part of #24.", state: "CLOSED"}));
        applyIssue(s, issue(31, ["triage"], {body: "Part of #24."}));
        applyIssue(s, issue(40, ["stage:todo"]));
        assert.deepEqual(scope(s, {epic: 24}), [25, 31]);
        assert.equal(isQuiet(s, scope(s, {epic: 24})), true);
        assert.equal(isQuiet(s, scope(s, {})), false);
    });
    test("three tries park; waking resumes at the stage it parked from", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        assert.deepEqual(recordTry(s, 25), {tries: 1, park: false});
        recordTry(s, 25);
        assert.deepEqual(recordTry(s, 25), {tries: 3, park: true});
        park(s, 25);
        assert.equal(s.issues[25].stage, "stage:parked");
        assert.equal(wake(s, 25), "stage:review");
        assert.equal(s.issues[25].tries, 0);
    });
    test("label operations queue and drain", () => {
        const s = emptyState();
        queueLabel(s, {issue: 25, add: ["stage:review"], remove: ["stage:in-progress"]});
        assert.equal(takeQueuedLabels(s).length, 1);
        assert.equal(takeQueuedLabels(s).length, 0);
    });
    test("ceilings", () => {
        const s = emptyState();
        s.run.tokens = 150;
        assert.equal(ceiling(s, settings), "soft");
        s.run.tokens = 250;
        assert.equal(ceiling(s, settings), "hard");
    });
    test("a stage change resets tries and rewrites the stage label", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["enhancement", "stage:review"]));
        recordTry(s, 25);
        setStage(s, 25, "stage:in-progress");
        assert.equal(s.issues[25].tries, 0);
        assert.deepEqual(s.issues[25].labels, ["enhancement", "stage:in-progress"]);
        assert.equal(s.issues[25].stage, "stage:in-progress");
    });
    test("park and wake update labels", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        park(s, 25);
        assert.deepEqual(s.issues[25].labels, ["stage:parked"]);
        wake(s, 25);
        assert.deepEqual(s.issues[25].labels, ["stage:review"]);
    });
    test("refreshing keeps tries at the same stage and resets them at a new one", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        recordTry(s, 25);
        applyIssue(s, issue(25, ["stage:review"]));
        assert.equal(s.issues[25].tries, 1);
        applyIssue(s, issue(25, ["stage:in-progress"]));
        assert.equal(s.issues[25].tries, 0);
    });
    test("refreshing preserves session, board and blockers", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"], {blockedBy: [3]}));
        s.issues[25].session = {container: "x"};
        s.issues[25].board = {card: 1};
        applyIssue(s, issue(25, ["stage:review"]));
        assert.deepEqual(s.issues[25].session, {container: "x"});
        assert.deepEqual(s.issues[25].board, {card: 1});
        assert.deepEqual(s.issues[25].blockers, [3]);
    });
    test("re-applying a closed issue marks it closed", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        assert.equal(s.issues[25].closed, false);
        applyIssue(s, issue(25, ["stage:done"], {state: "CLOSED"}));
        assert.equal(s.issues[25].closed, true);
    });
    test("save then load round-trips without a leftover temporary file", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-"));
        const file = path.join(dir, "sub", "state.json");
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        saveState(file, s);
        assert.deepEqual(loadState(file), s);
        assert.deepEqual(fs.readdirSync(path.dirname(file)), ["state.json"]);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600, "it holds the mint key");
        fs.rmSync(dir, {recursive: true});
    });
    test("loading a missing file gives an empty state", () => {
        assert.deepEqual(loadState("/nonexistent/state.json"), emptyState());
    });
    test("usage adds up", () => {
        const s = emptyState();
        addUsage(s, {tokens: 10, costUsd: 0.5});
        addUsage(s, {tokens: 5, costUsd: 0.25});
        assert.equal(s.run.tokens, 15);
        assert.equal(s.run.costUsd, 0.75);
    });
    test("ceilings of 0 are off", () => {
        const s = emptyState();
        s.run.tokens = 1e9;
        assert.equal(ceiling(s, {softTokens: 0, hardTokens: 0}), "ok");
    });
    test("waking without a remembered stage gives stage:todo; parking twice keeps the first", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:parked"]));
        assert.equal(wake(s, 25), "stage:todo");
        applyIssue(s, issue(26, ["stage:qa"]));
        park(s, 26);
        park(s, 26);
        assert.equal(wake(s, 26), "stage:qa");
    });
    test("blocked without blockers, or by a blocker not in state, is not due", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:blocked"]));
        applyIssue(s, issue(26, ["stage:blocked"], {blockedBy: [99]}));
        assert.deepEqual(dueIssues(s, settings, new Date()), []);
    });
    test("the try limit can be given", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        assert.equal(recordTry(s, 25, 2).park, false);
        assert.equal(recordTry(s, 25, 2).park, true);
    });
    test("a scope with a startable blocked issue is not quiet", () => {
        const s = emptyState();
        applyIssue(s, issue(28, ["stage:done"], {state: "CLOSED", body: "Part of #24."}));
        applyIssue(s, issue(26, ["stage:blocked"], {blockedBy: [28], body: "Part of #24."}));
        assert.equal(isQuiet(s, scope(s, {epic: 24})), false);
    });
    test("an issue waiting for a person is not due until its stage changes", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:todo"]));
        s.issues[25].waiting = true;
        applyIssue(s, issue(25, ["stage:todo"]));
        assert.deepEqual(dueIssues(s, settings, new Date()), []);
        assert.equal(isQuiet(s, [25]), true);
        applyIssue(s, issue(25, ["stage:tests"]));
        assert.deepEqual(dueIssues(s, settings, new Date()), [25]);
        s.issues[25].waiting = true;
        setStage(s, 25, "stage:in-progress");
        assert.equal(s.issues[25].waiting, false);
    });
    test("the time the loop parked an issue lasts while it stays parked", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:parked"]));
        s.issues[25].parkedAt = "2026-10-21T19:00:00Z";
        applyIssue(s, issue(25, ["stage:parked"]));
        assert.equal(s.issues[25].parkedAt, "2026-10-21T19:00:00Z");
        applyIssue(s, issue(25, ["stage:todo"]));
        assert.equal(s.issues[25].parkedAt, null);
    });
});
