// test/pipeline/carry.test.js: what a stage's new session takes over from one a usage limit
// stopped, and the comment that names a fallback harness.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {carryOf, fallbackNote} from "../../pipeline/lib/carry.js";

const gone = {
    harness: "claude",
    model: "claude-opus-5-5",
    session: "s1",
    outbox: "/old",
    persona: "builder",
    stage: "build"
};
const claude = {harness: "claude", model: "claude-opus-5-5", planned: false};
const who = {persona: "builder", profile: true, route: claude};

describe("carryOf", () => {
    test("nothing when no session was interrupted", () => {
        assert.deepEqual(carryOf(null, "build", who), {});
        assert.deepEqual(carryOf(undefined, "build", who), {});
    });
    test("nothing from an interruption of another stage", () => {
        assert.deepEqual(carryOf(gone, "review", who), {});
    });
    test("the same harness, persona and a profile resume the session with the carry", () => {
        assert.deepEqual(carryOf(gone, "build", who), {
            carryFrom: "/old",
            resume: {session: "s1", carryFrom: "/old"}
        });
    });
    test("another harness, no profile or no session to resume take the carry only", () => {
        const codex = {harness: "codex", model: "gpt-5.5", planned: false};
        assert.deepEqual(carryOf(gone, "build", {...who, route: codex}), {carryFrom: "/old"});
        assert.deepEqual(carryOf(gone, "build", {...who, profile: false}), {carryFrom: "/old"});
        assert.deepEqual(carryOf({...gone, session: null}, "build", who), {carryFrom: "/old"});
    });
});

describe("fallbackNote", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    const codex = {harness: "codex", model: "gpt-5.5", planned: false};
    test("names the fallback, the harness at its limit and the reset time today", () => {
        assert.equal(
            fallbackNote({
                stage: "build",
                route: codex,
                from: "claude",
                until: "2026-11-10T15:00:00.000Z",
                now
            }),
            "Pipeline: build runs on codex gpt-5.5, not claude: claude is at its usage limit " +
                "until 15:00 UTC (`PIPELINE_ON_LIMIT=fallback`)."
        );
    });
    test("names the date of a reset on another day", () => {
        assert.match(
            fallbackNote({
                stage: "build",
                route: codex,
                from: "claude",
                until: "2026-11-11T09:00:00.000Z",
                now
            }),
            /until 2026-11-11 09:00 UTC/
        );
    });
});
