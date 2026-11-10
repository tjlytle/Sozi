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
    test("a session and a spawn line name their harness and model", () => {
        const state = opened();
        const since = "2026-10-23T10:30:00.000Z";
        state.issues[124] = {
            stage: "stage:review",
            tries: 0,
            session: {
                container: "factory-124-review-0130",
                started: since,
                stage: "review",
                harness: "codex",
                model: "gpt-5.5"
            }
        };
        state.run.sessions.push({
            container: "factory-0-spawn-ab12",
            started: since,
            persona: "advocate",
            harness: "claude",
            model: "claude-opus-5-5"
        });
        const lines = statusText(state).split("\n");
        assert.ok(
            lines.includes(`#124 review: factory-124-review-0130 since ${since} on codex gpt-5.5`)
        );
        assert.ok(
            lines.includes(
                `spawn advocate: factory-0-spawn-ab12 since ${since} on claude claude-opus-5-5`
            )
        );
    });
    test("a session saved before harnesses were recorded prints without them", () => {
        const state = opened();
        const since = "2026-10-23T10:30:00.000Z";
        state.issues[124] = {
            stage: "stage:review",
            tries: 0,
            session: {container: "c124", started: since, stage: "review"}
        };
        state.run.sessions.push({container: "cs", started: since, persona: "advocate"});
        const lines = statusText(state).split("\n");
        assert.ok(lines.includes(`#124 review: c124 since ${since}`));
        assert.ok(lines.includes(`spawn advocate: cs since ${since}`));
    });
});
