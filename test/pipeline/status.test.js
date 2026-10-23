// test/pipeline/status.test.js: the --status report.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {emptyState} from "../../pipeline/lib/state.js";
import {statusText} from "../../pipeline/lib/status.js";

/**
 * An empty state as the loop leaves it once a run opened.
 *
 * @returns {any} - The state.
 */
function opened() {
    const state = emptyState();
    Object.assign(state.run, {started: "2026-10-23T10:00:00.000Z", sessions: [], spawns: []});
    return state;
}

describe("statusText", () => {
    test("shows a logged-out persona with the login command", () => {
        const state = opened();
        state.run.loggedOut = {builder: {since: "2026-10-23T11:00:00.000Z"}};
        const line = "builder: logged out; run npm run pipeline -- --login builder";
        assert.ok(statusText(state).split("\n").includes(line));
    });
    test("shows no logged-out line when every persona is logged in", () => {
        assert.doesNotMatch(statusText(opened()), /logged out/);
    });
});
