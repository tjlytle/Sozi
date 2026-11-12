// test/pipeline/running.test.js: counting the sessions running now, in all and per persona.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {atPersonaLimit, running, runningFor} from "../../pipeline/lib/running.js";

/**
 * A pass context holding only what the counts read.
 *
 * @param {{issues?: Record<number, {session: object | null}>, spawns?: object[], perPersona?: number}} parts - The issue records, the spawned sessions and the persona limit.
 * @returns {any} The context.
 */
function ctxWith({issues = {}, spawns = [], perPersona = 1}) {
    return {state: {issues, run: {sessions: spawns}}, settings: {perPersona}};
}

describe("running", () => {
    test("counts issue sessions and spawned sessions together", () => {
        const ctx = ctxWith({
            issues: {1: {session: {persona: "builder"}}, 2: {session: null}},
            spawns: [{persona: "advocate"}]
        });
        assert.equal(running(ctx), 2);
    });
});

describe("runningFor", () => {
    test("counts one persona's issue and spawned sessions", () => {
        const ctx = ctxWith({
            issues: {1: {session: {persona: "qa"}}, 2: {session: {persona: "builder"}}},
            spawns: [{persona: "qa"}]
        });
        assert.equal(runningFor(ctx, "qa"), 2);
    });
    test("an issue session recorded without a persona counts for none", () => {
        const ctx = ctxWith({issues: {1: {session: {container: "c1"}}}});
        assert.equal(runningFor(ctx, "builder"), 0);
    });
});

describe("atPersonaLimit", () => {
    test("a persona with as many sessions as the limit is at it", () => {
        const ctx = ctxWith({issues: {1: {session: {persona: "builder"}}}});
        assert.equal(atPersonaLimit(ctx, "builder"), true);
        assert.equal(atPersonaLimit(ctx, "qa"), false);
    });
    test("a limit of 0 means none", () => {
        const ctx = ctxWith({issues: {1: {session: {persona: "builder"}}}, perPersona: 0});
        assert.equal(atPersonaLimit(ctx, "builder"), false);
    });
});
