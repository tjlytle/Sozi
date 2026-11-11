// test/pipeline/profile-verdict.test.js: the verdict on a persona's profile for one harness.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {profileFor} from "../../pipeline/lib/profile-verdict.js";

/**
 * An inspected profile, logged in everywhere, holding the servers given.
 *
 * @param {object} [over] - Fields to replace.
 * @returns {object} The profile.
 */
function info(over = {}) {
    return {
        claude: {present: true, loggedIn: true, servers: [], updated: "2026-11-01T00:00:00Z"},
        codex: {present: true, loggedIn: true},
        agy: {present: true, loggedIn: true},
        writable: true,
        ...over
    };
}

/**
 * A pass context with a sandbox that answers the profile given and counts its inspections.
 *
 * @param {object | null} profile - What the inspection finds.
 * @param {{profiles?: string, env?: Record<string, string>, allowed?: string[]}} [options] - The settings.
 * @returns {any} The context, with `inspected` counting the inspections.
 */
function world(profile, {profiles = "on", env = {}, allowed = []} = {}) {
    const ctx = {
        inspected: 0,
        settings: {profiles, mcpFor: () => allowed},
        env,
        profiles: new Map(),
        sandbox: {
            inspectProfile: async () => {
                ctx.inspected++;
                return profile;
            }
        }
    };
    return ctx;
}

describe("profileFor", () => {
    test("with profiles off, it starts unmounted and inspects nothing", async () => {
        const ctx = world(info(), {profiles: "off"});
        assert.deepEqual(await profileFor(ctx, "builder", "claude"), {
            profile: false,
            updated: null
        });
        assert.equal(ctx.inspected, 0);
    });
    test("with no profile, a Claude token stands in for one", async () => {
        const ctx = world(null, {env: {CLAUDE_CODE_OAUTH_TOKEN: "t"}});
        assert.deepEqual(await profileFor(ctx, "builder", "claude"), {
            profile: false,
            updated: null
        });
    });
    test("with no profile and no token, it is refused with the login command", async () => {
        const verdict = await profileFor(world(null), "builder", "claude");
        assert.deepEqual(verdict, {
            refused: "no profile for builder: run npm run pipeline -- --login builder"
        });
    });
    test("a token does not stand in for a profile on another harness", async () => {
        const ctx = world(null, {env: {ANTHROPIC_API_KEY: "k"}});
        assert.deepEqual(await profileFor(ctx, "builder", "codex"), {
            refused:
                "no profile for builder: run npm run pipeline -- --login builder --harness codex"
        });
    });
    test("a profile not logged in to Claude is refused", async () => {
        const profile = info({claude: {present: true, loggedIn: false, servers: []}});
        assert.deepEqual(await profileFor(world(profile), "qa", "claude"), {
            refused: "profile of qa is not logged in"
        });
    });
    for (const harness of ["codex", "agy"]) {
        test(`a profile not logged in to ${harness} is refused with the login command`, async () => {
            const profile = info({[harness]: {present: true, loggedIn: false}});
            assert.deepEqual(await profileFor(world(profile), "qa", harness), {
                refused: `profile of qa is not logged in to ${harness}: run npm run pipeline -- --login qa --harness ${harness}`
            });
        });
    }
    test("an opencode start is not judged on its login", async () => {
        const profile = info({
            claude: {present: true, loggedIn: true, servers: []},
            agy: undefined
        });
        assert.deepEqual(await profileFor(world(profile), "qa", "opencode"), {
            profile: true,
            updated: null
        });
    });
    test("a server outside the allowlist is refused by name", async () => {
        const profile = info({
            claude: {present: true, loggedIn: true, servers: ["notion", "slack"]},
            codex: {present: true, loggedIn: true, servers: ["linear"]}
        });
        const ctx = world(profile, {allowed: ["notion"]});
        assert.deepEqual(await profileFor(ctx, "ops", "claude"), {
            refused: "profile of ops holds MCP servers not allowed: linear (codex), slack"
        });
    });
    test("a profile that passes is mounted, with when its credentials changed", async () => {
        assert.deepEqual(await profileFor(world(info()), "builder", "claude"), {
            profile: true,
            updated: "2026-11-01T00:00:00Z"
        });
    });
    test("a second call in the same pass does not inspect again", async () => {
        const ctx = world(info());
        const first = await profileFor(ctx, "builder", "claude");
        const second = await profileFor(ctx, "builder", "claude");
        assert.equal(second, first);
        assert.equal(ctx.inspected, 1);
        await profileFor(ctx, "builder", "codex");
        assert.equal(ctx.inspected, 2, "each harness is judged once");
    });
});
