import {test, describe} from "node:test";
import assert from "node:assert/strict";
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
    ceiling
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
});
