// test/pipeline/routing.test.js: the harness and model a plan names for each stage.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {HARNESSES, planRoutes} from "../../pipeline/lib/routing.js";

/**
 * A plan comment with the given Harness section body, between the headings around it.
 *
 * @param {string} harness - The lines under the Harness heading.
 * @returns {string} - The plan text.
 */
function plan(harness) {
    return [
        "**Implementation Plan**",
        "",
        "**Decisions taken**",
        "",
        "- review: claude claude-opus-5-5 is mentioned here, outside the section",
        "",
        "**Harness**",
        "",
        harness,
        "",
        "**Blocked by**",
        "",
        "none."
    ].join("\n");
}

describe("HARNESSES", () => {
    test("lists the four adapters", () => {
        assert.deepEqual(HARNESSES, ["claude", "codex", "agy", "opencode"]);
    });
});

describe("planRoutes", () => {
    test("reads one stage from the Harness section", () => {
        assert.deepEqual(planRoutes(plan("- review: codex gpt-5.5")), {
            routes: {review: {harness: "codex", model: "gpt-5.5"}},
            bad: []
        });
    });
    test("reads several stages, list and bare forms alike", () => {
        const text = plan(
            "- build: codex gpt-5.5\nreview: agy gemini-3-pro\n- `qa: claude claude-opus-5-5`"
        );
        assert.deepEqual(planRoutes(text).routes, {
            build: {harness: "codex", model: "gpt-5.5"},
            review: {harness: "agy", model: "gemini-3-pro"},
            qa: {harness: "claude", model: "claude-opus-5-5"}
        });
    });
    test("lines outside the Harness section are ignored", () => {
        const text = plan("none");
        assert.deepEqual(planRoutes(text), {routes: {}, bad: []});
    });
    test("a plan without the section gives no routes", () => {
        assert.deepEqual(planRoutes("**Shape**\n\n- review: codex gpt-5.5\n"), {
            routes: {},
            bad: []
        });
        assert.deepEqual(planRoutes(""), {routes: {}, bad: []});
    });
    test("plan, an unknown stage, an unknown harness or a missing model is bad", () => {
        const text = plan(
            "- plan: codex gpt-5.5\n- deploy: codex gpt-5.5\n- review: codx gpt-5.5\n- qa: codex"
        );
        assert.deepEqual(planRoutes(text), {
            routes: {},
            bad: [
                "plan: codex gpt-5.5",
                "deploy: codex gpt-5.5",
                "review: codx gpt-5.5",
                "qa: codex"
            ]
        });
    });
    test("a bad line does not hide the good ones", () => {
        const text = plan("- review: codx gpt-5.5\n- build: codex gpt-5.5");
        assert.deepEqual(planRoutes(text), {
            routes: {build: {harness: "codex", model: "gpt-5.5"}},
            bad: ["review: codx gpt-5.5"]
        });
    });
});
