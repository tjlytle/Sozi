/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Keeps each epic's sub-issues on GitHub in step with the `Part of #<epic>` lines, so a
// person opening an epic sees its issues. Nothing in the loop reads the links back.

import {RateLimited} from "./github.js";

/**
 * Link, move or unlink every known issue whose `Part of` epic differs from the epic the
 * loop last linked it to. An issue never seen before has its parent read once first, so
 * one linked by hand costs no write. A failure is logged and tried again at the next
 * sync; a rate limit stops the walk and is rethrown for the caller to back off.
 *
 * @param {import("./sync.js").PassContext} ctx - The pass context.
 * @returns {Promise<void>}
 */
export async function linkSubIssues(ctx) {
    const {github} = ctx;
    for (const [key, record] of Object.entries(ctx.state.issues)) {
        const n = Number(key);
        try {
            if (record.linked === undefined) {
                record.linked = await github.parentOf(n);
            }
            if (record.epic === record.linked) {
                continue;
            }
            if (record.epic !== null) {
                await github.linkSubIssue(record.epic, n);
            } else if (record.linked) {
                await github.unlinkSubIssue(record.linked, n);
            }
            record.linked = record.epic;
        } catch (error) {
            if (error instanceof RateLimited) {
                throw error;
            }
            ctx.log(`#${n}: sub-issue link failed: ${String(error)}`);
        }
    }
}
