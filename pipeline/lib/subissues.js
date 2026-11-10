/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Keeps each epic's sub-issues on GitHub in step with the `Part of #<epic>` lines, so a
// person opening an epic sees its issues. Nothing in the loop reads the links back.

import {RateLimited} from "./github.js";

/** GitHub's refusal when an epic already has its maximum of sub-issues. */
const EPIC_FULL = /more than (\d+) sub-issues/;

/**
 * Link, move or unlink every known issue whose `Part of` epic differs from the epic the
 * loop last linked it to. An issue never seen before has its parent read once first, so
 * one linked by hand costs no write. A failure is logged and tried again at the next
 * sync; a rate limit stops the walk and is rethrown for the caller to back off. An epic
 * GitHub calls full is tried once a sync: its other issues wait, with one log line.
 *
 * @param {import("./sync.js").PassContext} ctx - The pass context.
 * @returns {Promise<void>}
 */
export async function linkSubIssues(ctx) {
    const {github} = ctx;
    /** @type {Map<number, {limit: string, waiting: number}>} */
    const full = new Map();
    for (const [key, record] of Object.entries(ctx.state.issues)) {
        const n = Number(key);
        try {
            if (record.linked === undefined) {
                record.linked = await github.parentOf(n);
            }
            if (record.epic === record.linked) {
                continue;
            }
            const epicFull = record.epic === null ? undefined : full.get(record.epic);
            if (epicFull) {
                epicFull.waiting += 1;
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
            const limit = EPIC_FULL.exec(String(error));
            if (limit && record.epic !== null) {
                full.set(record.epic, {limit: limit[1], waiting: 1});
            } else {
                ctx.log(`#${n}: sub-issue link failed: ${String(error)}`);
            }
        }
    }
    for (const [epic, {limit, waiting}] of full) {
        const issues = waiting === 1 ? "1 issue waits" : `${waiting} issues wait`;
        ctx.log(`epic #${epic} is full (${limit} sub-issues): ${issues} to be linked`);
    }
}
