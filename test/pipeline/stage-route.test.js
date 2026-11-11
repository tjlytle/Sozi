// test/pipeline/stage-route.test.js: the harness and model a stage runs on, from its plan, its
// setting and the usage limits.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {RateLimited} from "../../pipeline/lib/github.js";
import {pickRoute, routeFor} from "../../pipeline/lib/stage-route.js";

const NOW = Date.parse("2026-11-10T10:00:00Z");
const LATER = "2026-11-10T12:00:00.000Z";

/**
 * A pass context with a plan comment, usage limits, fallbacks and per-harness logins.
 *
 * @param {object} [options] - The world.
 * @param {() => Promise<string | null>} [options.plan] - What the plan read returns.
 * @param {Record<string, {until: string, streak: number, reported: boolean}>} [options.limits] - The paused harnesses.
 * @param {string} [options.onLimit] - PIPELINE_ON_LIMIT.
 * @param {{harness: string, model: string}[]} [options.fallbacks] - The fallbacks of every harness.
 * @param {string[]} [options.loggedOut] - Harnesses the profile is not logged in to.
 * @param {string | null} [options.backoffUntil] - The GitHub back-off.
 * @returns {any} The context, with `logs` and `reads`.
 */
function world({
    plan = async () => null,
    limits = {},
    onLimit = "wait",
    fallbacks = [],
    loggedOut = [],
    backoffUntil = null
} = {}) {
    /** @type {string[]} */
    const logs = [];
    const ctx = {
        logs,
        reads: 0,
        settings: {
            profiles: "on",
            onLimit,
            harnessFor: () => "claude",
            modelFor: () => "opus",
            fallbackFor: () => fallbacks,
            mcpFor: () => []
        },
        state: {sync: {backoffUntil}, run: {limits}},
        clock: {now: () => NOW},
        env: {},
        profiles: new Map(),
        log: (/** @type {string} */ line) => logs.push(line),
        github: {
            planComment: async () => {
                ctx.reads++;
                return plan();
            }
        },
        sandbox: {
            inspectProfile: async () => ({
                claude: {present: true, loggedIn: !loggedOut.includes("claude"), servers: []},
                codex: {present: true, loggedIn: !loggedOut.includes("codex")},
                agy: {present: true, loggedIn: !loggedOut.includes("agy")},
                writable: true
            })
        }
    };
    return ctx;
}

const PLAN = "## Implementation Plan\n\n**Harness**\n\n- build: codex gpt-6\n\n**Blocked by**\n";

describe("routeFor", () => {
    test("the plan stage reads no plan and runs on its setting", async () => {
        const ctx = world({plan: async () => PLAN});
        const route = await routeFor(ctx, 7, "plan");
        assert.deepEqual(route, {harness: "claude", model: "opus", planned: false});
        assert.equal(ctx.reads, 0);
    });
    test("a plan line for the stage wins over the setting", async () => {
        const route = await routeFor(world({plan: async () => PLAN}), 7, "build");
        assert.deepEqual(route, {harness: "codex", model: "gpt-6", planned: true});
    });
    test("with no line for the stage, the setting applies", async () => {
        const route = await routeFor(world({plan: async () => PLAN}), 7, "review");
        assert.deepEqual(route, {harness: "claude", model: "opus", planned: false});
    });
    test("a bad Harness line is refused by name", async () => {
        const bad = "**Harness**\n\n- build: codex\n";
        assert.deepEqual(await routeFor(world({plan: async () => bad}), 7, "build"), {
            refused: '#7: plan Harness line "build: codex" is not <stage>: <harness> <model>'
        });
    });
    test("while GitHub is backed off, the plan is not read", async () => {
        const ctx = world({backoffUntil: LATER});
        assert.deepEqual(await routeFor(ctx, 7, "build"), {
            refused: "#7: waits, GitHub backed off, its plan is not read"
        });
        assert.equal(ctx.reads, 0);
    });
    test("a rate-limited read backs the loop off and refuses", async () => {
        const ctx = world({
            plan: async () => {
                throw new RateLimited("plan", new Date(LATER));
            }
        });
        assert.deepEqual(await routeFor(ctx, 7, "build"), {
            refused: "#7: waits, GitHub rate limited the read of its plan"
        });
        assert.equal(ctx.state.sync.backoffUntil, LATER);
    });
    test("any other failed read is thrown", async () => {
        const ctx = world({
            plan: async () => {
                throw new Error("network down");
            }
        });
        await assert.rejects(routeFor(ctx, 7, "build"), /network down/);
    });
});

describe("pickRoute", () => {
    const route = {harness: "claude", model: "opus", planned: true};
    const paused = {claude: {until: LATER, streak: 1, reported: false}};
    const fallbacks = [
        {harness: "codex", model: "gpt-6"},
        {harness: "agy", model: "gemini"}
    ];

    test("a harness that is not paused keeps its route", async () => {
        const pick = await pickRoute(world(), "builder", route);
        assert.deepEqual(pick, {route, verdict: {profile: true, updated: null}});
    });
    test("under the wait policy a paused harness waits for its reset", async () => {
        const pick = await pickRoute(world({limits: paused, fallbacks}), "builder", route);
        assert.deepEqual(pick, {wait: `claude is at its usage limit until ${LATER}`});
    });
    test("under the fallback policy a paused harness takes the first fallback", async () => {
        const ctx = world({limits: paused, fallbacks, onLimit: "fallback"});
        assert.deepEqual(await pickRoute(ctx, "builder", route), {
            route: {harness: "codex", model: "gpt-6", planned: false},
            verdict: {profile: true, updated: null},
            fallbackFrom: "claude"
        });
    });
    test("a fallback whose profile is refused is skipped for the next", async () => {
        const ctx = world({limits: paused, fallbacks, onLimit: "fallback", loggedOut: ["codex"]});
        const pick = await pickRoute(ctx, "builder", route);
        assert.deepEqual(pick, {
            route: {harness: "agy", model: "gemini", planned: false},
            verdict: {profile: true, updated: null},
            fallbackFrom: "claude"
        });
        assert.match(ctx.logs[0], /^fallback codex skipped: profile of builder is not logged in/);
    });
    test("with every fallback refused, it waits for the reset", async () => {
        const ctx = world({
            limits: paused,
            fallbacks,
            onLimit: "fallback",
            loggedOut: ["codex", "agy"]
        });
        const pick = await pickRoute(ctx, "builder", route);
        assert.deepEqual(pick, {wait: `claude is at its usage limit until ${LATER}`});
        assert.equal(ctx.logs.length, 2);
    });
});
