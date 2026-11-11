// test/pipeline/start-plan.test.js: starting a stage on the harness and model its plan's Harness line names.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {RateLimited} from "../../pipeline/lib/github.js";
import {issue, world} from "./pass-world.js";

/**
 * A plan comment whose Harness section holds the given lines.
 *
 * @param {string} lines - The lines under the Harness heading.
 * @returns {string} - The plan text.
 */
function planWith(lines) {
    return `**Implementation Plan**\n\n**Harness**\n\n${lines}\n\n**Blocked by**\n\nnone.\n`;
}

describe("the plan names the harness of a stage", () => {
    test("the plan's line starts the stage on its harness and model", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        w.github.planComment = async () => planWith("- review: codex gpt-5.5");
        w.profiles.reviewer = {...w.profiles.reviewer, codex: {present: true, loggedIn: true}};
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
        assert.equal(w.starts[0].harness, "codex");
        assert.equal(w.starts[0].model, "gpt-5.5");
        const session = w.state.issues[25].session;
        assert.equal(session.harness, "codex");
        assert.equal(session.model, "gpt-5.5");
        assert.equal(session.planned, true);
    });
    test("with no line for the stage, the setting decides", async () => {
        const w = world({
            issues: [issue(25, ["stage:in-progress"])],
            env: {PIPELINE_MODEL_BUILD: "claude-sonnet-5-5"}
        });
        w.github.planComment = async () => planWith("- review: codex gpt-5.5");
        await w.p.pass();
        assert.equal(w.starts[0].harness, "claude");
        assert.equal(w.starts[0].model, "claude-sonnet-5-5");
        assert.equal(w.state.issues[25].session.harness, "claude");
        assert.equal(w.state.issues[25].session.planned, false);
    });
    test("a missing login for the plan's harness is refused and the issue waits", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        w.github.planComment = async () => planWith("- review: codex gpt-5.5");
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.equal(w.starts.length, 0);
        assert.ok(
            w.logs.includes(
                "profile of reviewer is not logged in to codex: run npm run pipeline -- --login reviewer --harness codex"
            )
        );
        assert.ok(!w.state.issues[25].labels.includes("working"));
    });
    test("a bad line is refused by name and the issue waits", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        w.github.planComment = async () => planWith("- review: codx gpt-5.5");
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.ok(
            w.logs.includes(
                '#25: plan Harness line "review: codx gpt-5.5" is not <stage>: <harness> <model>'
            )
        );
    });
    test("while backed off the plan is not read and the issue waits", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        let reads = 0;
        w.github.planComment = async () => {
            reads++;
            return null;
        };
        w.state.sync.backoffUntil = new Date(w.clock.now() + 60000).toISOString();
        await w.p.pass();
        assert.equal(reads, 0);
        assert.equal(w.starts.length, 0);
    });
    test("a rate-limited read backs the loop off and the issue waits", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        const reset = new Date(w.clock.now() + 600000);
        w.github.planComment = async () => {
            throw new RateLimited("plan", reset);
        };
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.equal(w.state.sync.backoffUntil, reset.toISOString());
    });
    test("the plan stage never reads a plan", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        let reads = 0;
        w.github.planComment = async () => {
            reads++;
            return planWith("- plan: codex gpt-5.5");
        };
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25]);
        assert.equal(reads, 0);
        assert.equal(w.starts[0].harness, "claude");
    });
    test("a spawn records its harness and model", async () => {
        const w = world();
        w.state.run.spawns.push({
            persona: "advocate",
            prompt: "File Y",
            issue: null,
            harness: null
        });
        await w.p.pass();
        assert.equal(w.state.run.sessions[0].harness, "claude");
        assert.equal(w.state.run.sessions[0].model, w.settings.modelFor("qa"));
    });
});
