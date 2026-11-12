import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {emptyState, applyIssue, setStage} from "../../pipeline/lib/state.js";
import {dueIssues, scope, isQuiet, startOrder} from "../../pipeline/lib/due.js";
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

describe("due", () => {
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
    test("blocked without blockers, or by a blocker not in state, is not due", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:blocked"]));
        applyIssue(s, issue(26, ["stage:blocked"], {blockedBy: [99]}));
        assert.deepEqual(dueIssues(s, settings, new Date()), []);
    });
    test("a scope with a startable blocked issue is not quiet", () => {
        const s = emptyState();
        applyIssue(s, issue(28, ["stage:done"], {state: "CLOSED", body: "Part of #24."}));
        applyIssue(s, issue(26, ["stage:blocked"], {blockedBy: [28], body: "Part of #24."}));
        assert.equal(isQuiet(s, scope(s, {epic: 24})), false);
    });
    test("a blocked issue is quiet when no blocker can make progress", () => {
        /** @type {(blocker: string[], extra?: (s: any) => void) => boolean} */
        const quiet = (labels, extra = () => {}) => {
            const s = emptyState();
            applyIssue(s, issue(25, labels));
            applyIssue(s, issue(26, ["stage:blocked"], {blockedBy: [25]}));
            extra(s);
            return isQuiet(s, [25, 26]);
        };
        assert.equal(quiet(["stage:parked"]), true, "blocked by a parked issue");
        assert.equal(
            quiet(["stage:todo"], s => (s.issues[25].waiting = true)),
            true,
            "blocked by a waiting issue"
        );
        assert.equal(quiet(["triage"]), true, "blocked by an issue in triage");
        assert.equal(quiet(["stage:todo"]), false, "blocked by an open stage:todo issue");
        assert.equal(quiet(["stage:done"]), false, "blocked by a merged issue not yet closed");
    });
    test("a blocked cycle is quiet and does not recurse forever", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:blocked"], {blockedBy: [26]}));
        applyIssue(s, issue(26, ["stage:blocked"], {blockedBy: [25]}));
        assert.equal(isQuiet(s, [25, 26]), true);
    });
    test("a blocked issue with no blockers is quiet", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:blocked"]));
        assert.equal(isQuiet(s, [25]), true);
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
        setStage(s, 25, "stage:in-progress", "2026-10-21T01:00:00.000Z");
        assert.equal(s.issues[25].waiting, false);
    });
    test("due issues start in order: priority, then the longest wait in the stage, then number", () => {
        const s = emptyState();
        applyIssue(s, issue(10, ["stage:tests"], {updatedAt: "2026-11-10T12:00:00Z"}));
        applyIssue(s, issue(11, ["stage:tests"], {updatedAt: "2026-11-10T09:00:00Z"}));
        applyIssue(s, issue(12, ["stage:qa"], {updatedAt: "2026-11-10T09:00:00Z"}));
        applyIssue(s, issue(30, ["stage:qa", "priority"], {updatedAt: "2026-11-10T13:00:00Z"}));
        assert.deepEqual(dueIssues(s, settings, new Date()), [30, 11, 12, 10]);
    });
    test("a record saved before stageSince was kept sorts as the oldest", () => {
        const s = emptyState();
        applyIssue(s, issue(10, ["stage:tests"], {updatedAt: "2026-10-01T00:00:00Z"}));
        applyIssue(s, issue(20, ["stage:tests"]));
        applyIssue(s, issue(21, ["stage:tests"]));
        delete s.issues[20].stageSince;
        delete s.issues[21].stageSince;
        assert.deepEqual(dueIssues(s, settings, new Date()), [20, 21, 10]);
    });
    test("a supervised issue is not due, and is quiet, unless it is the run's only issue", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:in-progress", "supervised"]));
        applyIssue(s, issue(26, ["stage:todo"]));
        assert.deepEqual(dueIssues(s, settings, new Date()), [26]);
        assert.equal(isQuiet(s, [25]), true);
        s.run.only = 25;
        assert.deepEqual(dueIssues(s, settings, new Date()), [25, 26]);
        assert.equal(isQuiet(s, [25]), false);
    });
    test("startOrder compares priority, then stageSince, then number", () => {
        /** @type {(n: number, since: string | null, labels?: string[]) => [number, any]} */
        const entry = (n, since, labels = []) => [n, {labels, stageSince: since}];
        const early = "2026-11-10T09:00:00Z";
        const late = "2026-11-10T12:00:00Z";
        assert.ok(startOrder(entry(9, early), entry(5, late, ["priority"])) > 0);
        assert.ok(startOrder(entry(9, early), entry(5, late)) < 0);
        assert.ok(startOrder(entry(9, null), entry(5, early)) < 0);
        assert.ok(startOrder(entry(5, early), entry(9, early)) < 0);
    });
});
