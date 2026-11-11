/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The harness and model a session runs on now: the plan's Harness line or the stage's setting,
// then the usage limits and the fallbacks.

import {RateLimited} from "./github.js";
import {chooseHarness} from "./limits.js";
import {profileFor} from "./profile-verdict.js";
import {planRoutes} from "./routing.js";
import {backOff, inBackoff} from "./sync.js";

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 * @typedef {import("./profile-verdict.js").ProfileVerdict} ProfileVerdict
 * @typedef {{harness: string, model: string, planned: boolean}} StageRoute
 * @typedef {{route: StageRoute, verdict: ProfileVerdict, fallbackFrom?: string}} Pick
 */

/**
 * The harness and model a stage of an issue runs on: the line the newest plan has for the
 * stage, else the stage's setting. The plan stage reads no plan. Refused while GitHub is
 * backed off or rate limits the read, and when the plan's Harness section holds a line
 * that does not parse; any other failed read is thrown.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {string} stage - The prompt stage name.
 * @returns {Promise<StageRoute | {refused: string}>} The route, or why the issue waits.
 */
export async function routeFor(ctx, n, stage) {
    const {settings} = ctx;
    const setting = {harness: settings.harnessFor(stage), model: settings.modelFor(stage)};
    if (stage === "plan") {
        return {...setting, planned: false};
    }
    if (inBackoff(ctx)) {
        return {refused: `#${n}: waits, GitHub backed off, its plan is not read`};
    }
    let text;
    try {
        text = (await ctx.github.planComment(n)) ?? "";
    } catch (error) {
        if (!(error instanceof RateLimited)) {
            throw error;
        }
        backOff(ctx, error);
        return {refused: `#${n}: waits, GitHub rate limited the read of its plan`};
    }
    const {routes, bad} = planRoutes(text);
    if (bad.length > 0) {
        return {refused: `#${n}: plan Harness line "${bad[0]}" is not <stage>: <harness> <model>`};
    }
    const route = routes[stage];
    return route ? {...route, planned: true} : {...setting, planned: false};
}

/**
 * The route a session starts on now, with the verdict on the persona's profile for it. While the
 * route's harness is at its usage limit it waits, or under PIPELINE_ON_LIMIT=fallback it takes
 * the first fallback that is not paused and that the persona's profile is logged in to.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} persona - The persona.
 * @param {StageRoute} route - The harness and model it would run on.
 * @returns {Promise<Pick | {wait: string}>} - The route and verdict, or why it waits.
 */
export async function pickRoute(ctx, persona, route) {
    const {settings, state} = ctx;
    let fallbacks = settings.fallbackFor(route.harness);
    for (;;) {
        const choice = chooseHarness({
            route,
            fallbacks,
            policy: settings.onLimit,
            limits: state.run.limits,
            now: ctx.clock.now()
        });
        if ("wait" in choice) {
            return {wait: `${route.harness} is at its usage limit until ${choice.wait}`};
        }
        const verdict = await profileFor(ctx, persona, choice.harness);
        if (!("fallbackFrom" in choice)) {
            return {route, verdict};
        }
        // A profile left unmounted (PIPELINE_PROFILES=off, or a token) proves no login.
        if ("profile" in verdict && verdict.profile) {
            const {harness, model, fallbackFrom} = choice;
            return {route: {harness, model, planned: false}, verdict, fallbackFrom};
        }
        const why = "refused" in verdict ? verdict.refused : `no logged-in profile for ${persona}`;
        ctx.log(`fallback ${choice.harness} skipped: ${why}`);
        fallbacks = fallbacks.filter(f => f.harness !== choice.harness);
    }
}
