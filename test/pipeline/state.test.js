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
    recordTry,
    park,
    wake,
    queueLabel,
    takeQueuedLabels,
    ceiling,
    setStage,
    keepLeftover,
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
/** A stage time for tests that do not look at it. */
const at = "2026-10-21T01:00:00.000Z";

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
    test("three tries park; waking resumes at the stage it parked from", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        assert.deepEqual(recordTry(s, 25), {tries: 1, park: false});
        recordTry(s, 25);
        assert.deepEqual(recordTry(s, 25), {tries: 3, park: true});
        park(s, 25, at);
        assert.equal(s.issues[25].stage, "stage:parked");
        assert.equal(wake(s, 25, at), "stage:review");
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
        setStage(s, 25, "stage:in-progress", at);
        assert.equal(s.issues[25].tries, 0);
        assert.deepEqual(s.issues[25].labels, ["enhancement", "stage:in-progress"]);
        assert.equal(s.issues[25].stage, "stage:in-progress");
    });
    test("a stage change drops the patches left for the next try; a refresh keeps them", () => {
        const s = emptyState();
        const leftover = {stage: "build", outbox: "/old", patches: ["75-x.patch"]};
        applyIssue(s, issue(25, ["stage:in-progress"]));
        s.issues[25].leftover = leftover;
        applyIssue(s, issue(25, ["stage:in-progress"]));
        assert.deepEqual(s.issues[25].leftover, leftover);
        setStage(s, 25, "stage:in-progress", at);
        assert.deepEqual(s.issues[25].leftover, leftover);
        setStage(s, 25, "stage:review", at);
        assert.equal(s.issues[25].leftover, null);
        s.issues[25].leftover = leftover;
        applyIssue(s, issue(25, ["stage:in-progress"]));
        assert.equal(s.issues[25].leftover ?? null, null);
    });
    test("a try's patches replace the leftover; a try with none keeps the earlier one", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:in-progress"]));
        const earlier = {stage: "build", outbox: "/old", patches: ["75-x.patch"]};
        assert.equal(keepLeftover(s, 25, earlier), 1);
        assert.deepEqual(s.issues[25].leftover, earlier);
        assert.equal(keepLeftover(s, 25, {stage: "build", outbox: "/new", patches: []}), 0);
        assert.deepEqual(s.issues[25].leftover, earlier);
    });
    test("park and wake update labels", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        park(s, 25, at);
        assert.deepEqual(s.issues[25].labels, ["stage:parked"]);
        wake(s, 25, at);
        assert.deepEqual(s.issues[25].labels, ["stage:review"]);
    });
    test("reruns hold while the stage holds; a stage change resets them", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:qa"]));
        assert.equal(s.issues[25].reruns ?? 0, 0);
        s.issues[25].reruns = 2;
        applyIssue(s, issue(25, ["stage:qa"]));
        assert.equal(s.issues[25].reruns, 2);
        setStage(s, 25, "stage:in-progress", at);
        assert.equal(s.issues[25].reruns, 0);
        s.issues[25].reruns = 1;
        applyIssue(s, issue(25, ["stage:qa"]));
        assert.equal(s.issues[25].reruns ?? 0, 0);
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
    test("refreshing keeps the epic the loop last linked the issue to", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        assert.equal(s.issues[25].linked, undefined);
        s.issues[25].linked = 93;
        applyIssue(s, issue(25, ["stage:review"]));
        assert.equal(s.issues[25].linked, 93);
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
    test("a state saved before per-harness limits loads without the run-wide pause", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-"));
        const file = path.join(dir, "state.json");
        const old = emptyState();
        const run = /** @type {any} */ (old.run);
        delete run.limits;
        run.startsPausedUntil = "2026-11-10T15:00:00.000Z";
        /** @type {any} */ (old.sync).backoffStreak = 2;
        fs.writeFileSync(file, JSON.stringify(old));
        const loaded = loadState(file);
        assert.equal(loaded.run.startsPausedUntil, undefined);
        assert.equal(/** @type {any} */ (loaded.sync).backoffStreak, undefined);
        assert.deepEqual(loaded.run.limits, {});
        fs.rmSync(dir, {recursive: true});
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
        assert.equal(wake(s, 25, at), "stage:todo");
        applyIssue(s, issue(26, ["stage:qa"]));
        park(s, 26, at);
        park(s, 26, at);
        assert.equal(wake(s, 26, at), "stage:qa");
    });
    test("the try limit can be given", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        assert.equal(recordTry(s, 25, 2).park, false);
        assert.equal(recordTry(s, 25, 2).park, true);
    });
    test("two stage labels: the later stage in the stage order wins", () => {
        assert.equal(stageOf(["stage:review", "stage:todo"]), "stage:review");
        assert.equal(stageOf(["stage:qa", "stage:in-progress"]), "stage:qa");
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
    test("a stage change records when the issue entered the stage", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        setStage(s, 25, "stage:in-progress", "2026-11-12T10:00:00.000Z");
        assert.equal(s.issues[25].stageSince, "2026-11-12T10:00:00.000Z");
        park(s, 25, "2026-11-12T11:00:00.000Z");
        assert.equal(s.issues[25].stageSince, "2026-11-12T11:00:00.000Z");
        wake(s, 25, "2026-11-12T12:00:00.000Z");
        assert.equal(s.issues[25].stageSince, "2026-11-12T12:00:00.000Z");
    });
    test("refreshing keeps stageSince while the stage holds and takes updatedAt when it changes", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"], {updatedAt: "2026-11-10T09:00:00Z"}));
        assert.equal(s.issues[25].stageSince, "2026-11-10T09:00:00Z");
        applyIssue(s, issue(25, ["stage:review"], {updatedAt: "2026-11-10T10:00:00Z"}));
        assert.equal(s.issues[25].stageSince, "2026-11-10T09:00:00Z");
        applyIssue(s, issue(25, ["stage:qa"], {updatedAt: "2026-11-10T11:00:00Z"}));
        assert.equal(s.issues[25].stageSince, "2026-11-10T11:00:00Z");
    });
});
