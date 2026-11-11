/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The verdict on a persona's profile: may it start on a harness, and with its profile mounted.

import {checkAllowlist} from "./profile.js";

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 * @typedef {{profile: boolean, updated: string | null} | {refused: string}} ProfileVerdict
 */

/**
 * Judge a persona's profile: mount it, start without one, or refuse the start. A verdict
 * to start carries when the profile's credentials last changed, when known.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} persona - The persona.
 * @param {string} harness - The harness the session runs on.
 * @returns {Promise<ProfileVerdict>} The verdict.
 */
async function judgeProfile(ctx, persona, harness) {
    const {settings, sandbox, env} = ctx;
    if (settings.profiles === "off") {
        return {profile: false, updated: null};
    }
    /** @type {import("./profile.js").ProfileInfo | null} */
    const info = await sandbox.inspectProfile(persona);
    const harnessFlag = harness === "claude" ? "" : ` --harness ${harness}`;
    const login = `npm run pipeline -- --login ${persona}${harnessFlag}`;
    if (info === null) {
        // Only Claude has a token that stands in for a profile.
        if (harness === "claude" && (env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_API_KEY)) {
            return {profile: false, updated: null};
        }
        return {refused: `no profile for ${persona}: run ${login}`};
    }
    if (harness === "claude" && !info.claude.loggedIn) {
        return {refused: `profile of ${persona} is not logged in`};
    }
    // opencode keeps its login where the inspection does not look; its start is not judged.
    if ((harness === "codex" || harness === "agy") && !info[harness]?.loggedIn) {
        return {refused: `profile of ${persona} is not logged in to ${harness}: run ${login}`};
    }
    const extra = checkAllowlist(info, settings.mcpFor(persona));
    if (extra.length > 0) {
        return {
            refused: `profile of ${persona} holds MCP servers not allowed: ${extra.join(", ")}`
        };
    }
    return {profile: true, updated: info.claude.updated ?? null};
}

/**
 * The verdict on a persona's profile for one harness, inspected at most once a pass.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} persona - The persona.
 * @param {string} harness - The harness the session runs on.
 * @returns {Promise<ProfileVerdict>} The verdict.
 */
export async function profileFor(ctx, persona, harness) {
    const key = `${persona}/${harness}`;
    const cached = ctx.profiles.get(key);
    if (cached) {
        return cached;
    }
    const verdict = await judgeProfile(ctx, persona, harness);
    ctx.profiles.set(key, verdict);
    return verdict;
}
