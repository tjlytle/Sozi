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
    test("a run whose closing summary waits shows it is closing, and why", () => {
        const state = opened();
        state.run.closing = "until reached";
        const lines = statusText(state).split("\n");
        assert.ok(lines.includes("run: started 2026-10-23T10:00:00.000Z (closing: until reached)"));
        state.run.stopped = true;
        assert.ok(
            statusText(state)
                .split("\n")
                .includes("run: started 2026-10-23T10:00:00.000Z (stopped)")
        );
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
    test("a paused harness and an interrupted issue get a line each", () => {
        const state = opened();
        const now = new Date("2026-11-10T12:00:00.000Z");
        state.run.limits = {
            claude: {until: "2026-11-10T15:00:00.000Z", streak: 1, reported: true},
            codex: {until: "2026-11-10T13:00:00.000Z", streak: 2, reported: false},
            agy: {until: "2026-11-10T11:00:00.000Z", streak: 1, reported: false}
        };
        state.issues[125] = {
            stage: "stage:in-progress",
            tries: 0,
            session: null,
            interrupted: {harness: "claude", model: "m", session: "s", outbox: "o", stage: "build"}
        };
        const lines = statusText(state, now).split("\n");
        assert.ok(
            lines.includes("harness claude: paused until 2026-11-10T15:00:00Z (reset reported)")
        );
        assert.ok(
            lines.includes(
                "harness codex: paused until 2026-11-10T13:00:00Z (back-off, 2 in a row)"
            )
        );
        assert.ok(!lines.some(l => l.startsWith("harness agy")), "a pause that ended is not shown");
        assert.ok(
            lines.includes(
                "#125 stage:in-progress: interrupted on claude, resumes 2026-11-10T15:00:00Z"
            )
        );
    });
    test("an interrupted issue whose harness is free resumes at the next pass", () => {
        const state = opened();
        state.issues[125] = {
            stage: "stage:in-progress",
            tries: 0,
            session: null,
            interrupted: {harness: "claude", model: "m", session: "s", outbox: "o", stage: "build"}
        };
        const lines = statusText(state, new Date("2026-11-10T12:00:00.000Z")).split("\n");
        assert.ok(
            lines.includes("#125 stage:in-progress: interrupted on claude, resumes next pass")
        );
    });
});
