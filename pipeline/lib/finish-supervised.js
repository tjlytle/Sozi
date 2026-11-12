/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Judging an ended session, the supervision side (#516): a plan that changes the pipeline
// or .claude/ labels its issue supervised, and a protected patch a stage left is kept for
// the supervisor to show Tim. Apart from finish.js, which judges requests, waits and tries.

import fs from "node:fs";
import path from "node:path";
import {RateLimited} from "./github.js";
import {readBounded} from "./outbox.js";
import {SUPERVISED, planNeedsSupervision, protectedPatchPaths} from "./supervised.js";
import {backOff, inBackoff, writeComment, writeLabel} from "./sync.js";

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 */

/** The name of the patch a stage leaves in its outbox for a write under .claude/. */
const PROTECTED_PATCH = "protected.patch";

/** The largest protected patch read, in bytes. */
const MAX_PROTECTED_BYTES = 5 * 1024 * 1024;

/**
 * Label an issue supervised, in the state and on GitHub, unless it already is.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @returns {Promise<void>}
 */
async function addSupervised(ctx, n) {
    const record = ctx.state.issues[n];
    if (record.labels.includes(SUPERVISED)) {
        return;
    }
    record.labels.push(SUPERVISED);
    ctx.changed.add(n);
    ctx.log(`#${n}: labelled ${SUPERVISED}`);
    await writeLabel(ctx, {issue: n, add: [SUPERVISED], remove: []});
}

/**
 * Label an issue supervised when its plan's Shape changes the pipeline or .claude/. While
 * GitHub backs the loop off the plan is not read, and the label waits for a person.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue whose plan session moved it on.
 * @returns {Promise<void>}
 */
export async function labelIfPlanned(ctx, n) {
    if (inBackoff(ctx)) {
        return;
    }
    let plan;
    try {
        plan = await ctx.github.planComment(n);
    } catch (error) {
        if (error instanceof RateLimited) {
            backOff(ctx, error);
        }
        ctx.log(`#${n}: plan not read for the ${SUPERVISED} label: ${String(error)}`);
        return;
    }
    if (planNeedsSupervision(plan ?? "")) {
        await addSupervised(ctx, n);
    }
}

/**
 * Keep the protected patch a session left in its outbox, as `<n>.patch` in the protected
 * directory, and label its issue supervised. A patch naming a path outside .claude/ is
 * refused with a comment on the issue and not kept.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {string} outbox - The session's outbox.
 * @returns {Promise<string | null>} - Why the issue now waits for a person, or null when
 *     no patch was kept.
 */
export async function keepProtected(ctx, n, outbox) {
    const read = readBounded(path.join(outbox, PROTECTED_PATCH), MAX_PROTECTED_BYTES);
    if ("refused" in read) {
        if (read.refused !== "missing") {
            ctx.log(`#${n}: ${PROTECTED_PATCH} not read: ${read.refused}`);
        }
        return null;
    }
    try {
        protectedPatchPaths(read.text);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        ctx.log(`#${n}: ${PROTECTED_PATCH} refused: ${reason}`);
        const only = "Only paths under `.claude/` go through the supervisor.";
        await writeComment(ctx, n, `The protected patch was refused: ${reason}. ${only}`);
        return null;
    }
    fs.mkdirSync(ctx.protectedDir, {recursive: true});
    fs.writeFileSync(path.join(ctx.protectedDir, `${n}.patch`), read.text);
    await addSupervised(ctx, n);
    return "a protected patch waits for the supervisor";
}
