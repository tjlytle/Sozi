/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Parking an issue: the tries that lead to it, the stub-harness park, and the comment that
// says why.

import {logTail} from "./outbox.js";
import {park, promptFor, recordTry} from "./state.js";
import {writeComment, writeLabel} from "./sync.js";

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 */

/**
 * Park an issue, note when, comment why (or queue the comment) and record the move.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {string} text - The comment.
 * @returns {Promise<void>}
 */
async function parkIssue(ctx, n, text) {
    const stage = ctx.state.issues[n].stage;
    const now = new Date(ctx.clock.now()).toISOString();
    park(ctx.state, n, now);
    ctx.state.issues[n].parkedAt = now;
    await writeComment(ctx, n, text);
    await writeLabel(ctx, {issue: n, add: ["stage:parked"], remove: stage ? [stage] : []});
    ctx.summary.moved.push([n, stage, "stage:parked"]);
    ctx.summary.parked.push(n);
    ctx.changed.add(n);
}

/**
 * Count a try for an issue that did not move; on the last, park it with the log tail.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {string} outbox - The outbox, for the log tail.
 * @returns {Promise<void>}
 */
export async function countTry(ctx, n, outbox) {
    const {state, settings} = ctx;
    const stage = state.issues[n].stage;
    ctx.tried.add(n);
    const {tries, park: parks} = recordTry(state, n, settings.maxTries || undefined);
    ctx.log(`#${n}: no move from ${stage}; try ${tries}`);
    if (!parks) {
        return;
    }
    await parkIssue(
        ctx,
        n,
        `Pipeline: the ${promptFor(stage) ?? stage} stage ended ${tries} times without moving ` +
            `this issue, so I am parking it. @${settings.human}, the log tail:\n\n` +
            "```\n" +
            `${logTail(outbox)}\n` +
            "```\n"
    );
}

/**
 * Park an issue whose session ran on a stub harness, naming the harness and the stage, and
 * the plan's Harness line or the stage setting that chose it.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @returns {Promise<void>}
 */
export async function parkStub(ctx, n) {
    const {stage, planned, harness = ctx.settings.harnessFor(stage)} = ctx.state.issues[n].session;
    const fix = planned
        ? `change the plan's **Harness** line for \`${stage}\``
        : `set \`PIPELINE_HARNESS_${stage.toUpperCase()}\``;
    ctx.log(`#${n}: the ${harness} harness is a stub; parking`);
    await parkIssue(
        ctx,
        n,
        `Pipeline: the \`${harness}\` harness is a stub (\`status: unsupported\`), so the ` +
            `\`${stage}\` stage cannot run; parking. @${ctx.settings.human}, ${fix} to a ` +
            "working harness and comment to wake it."
    );
}
