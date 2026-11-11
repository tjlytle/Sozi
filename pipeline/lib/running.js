/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Counting the sessions running now, for issues and spawned ones, in all and per persona, and
// whether a persona is at its limit. Pure functions over the pass context's state and settings.

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 */

/**
 * Count the sessions running now, for issues and spawned ones.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {number} The count.
 */
export function running(ctx) {
    const issues = Object.values(ctx.state.issues).filter(r => r.session).length;
    return issues + ctx.state.run.sessions.length;
}

/**
 * Count the sessions of one persona running now; an issue session recorded before
 * sessions carried a persona counts for none.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} persona - The persona.
 * @returns {number} The count.
 */
export function runningFor(ctx, persona) {
    const issues = Object.values(ctx.state.issues).filter(
        r => /** @type {{persona?: string} | null} */ (r.session)?.persona === persona
    ).length;
    const spawns = ctx.state.run.sessions.filter(
        (/** @type {{persona: string}} */ s) => s.persona === persona
    ).length;
    return issues + spawns;
}

/**
 * Tell whether a persona has as many sessions as it may run at once.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} persona - The persona.
 * @returns {boolean} True when another session of it must wait.
 */
export function atPersonaLimit(ctx, persona) {
    const limit = ctx.settings.perPersona;
    return limit > 0 && runningFor(ctx, persona) >= limit;
}
