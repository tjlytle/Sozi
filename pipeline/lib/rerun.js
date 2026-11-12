/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A QA session's request to rerun its PR's CI run. The loop does not take the session's
// word: it reads the run from GitHub and reruns only one on the issue's branch that has
// finished, or that has sat queued with no jobs while newer runs started.

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 * @typedef {import("./github-runs.js").Run} Run
 */

/** Reruns the loop makes for an issue in one visit to stage:qa. */
export const RERUN_LIMIT = 3;

/** How long a run sits queued with no jobs before it counts as stuck. */
export const STUCK_AFTER_MS = 20 * 60 * 1000;

const POLL_MS = 5 * 1000;
const POLL_LIMIT_MS = 60 * 1000;

/**
 * Decide what to do with a run a session asked to rerun: rerun a finished one, cancel and
 * rerun a stuck one, and refuse anything else.
 *
 * @param {object} facts - What GitHub says.
 * @param {Run} facts.run - The run.
 * @param {Run[]} facts.newer - Recent runs in the repository; those created after the run count.
 * @param {number} facts.issue - The issue whose session asked.
 * @param {number} facts.now - The time, in epoch milliseconds.
 * @param {number} facts.stuckAfterMs - How long a run may sit queued before it is stuck.
 * @returns {{action: "cancel-rerun" | "rerun"} | {refused: string}} The action, or why not.
 */
export function rerunAction({run, newer, issue, now, stuckAfterMs}) {
    const id = run.databaseId;
    if (!String(run.headBranch ?? "").startsWith(`${issue}-`)) {
        return {refused: `run ${id} is on branch ${run.headBranch}, not one of issue ${issue}'s`};
    }
    if (run.status === "completed") {
        return {action: "rerun"};
    }
    if (run.status !== "queued") {
        return {refused: `run ${id} is ${run.status}, neither queued nor completed`};
    }
    if ((run.jobs ?? []).length > 0) {
        return {refused: `run ${id} is queued but has jobs`};
    }
    const created = Date.parse(run.createdAt);
    if (!(now - created > stuckAfterMs)) {
        const waited = Math.floor((now - created) / 60000);
        const limit = Math.round(stuckAfterMs / 60000);
        return {refused: `run ${id} queued ${waited} minutes; not stuck before ${limit} minutes`};
    }
    const started = newer.some(
        r => r.databaseId !== id && Date.parse(r.createdAt) > created && r.status !== "queued"
    );
    if (!started) {
        return {refused: `no run newer than ${id} has started; GitHub is backed up, not this run`};
    }
    return {action: "cancel-rerun"};
}

/**
 * Wait for a cancelled run to complete, reading it every 5 s for at most 60 s.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} id - The run.
 * @param {(ms: number) => Promise<void>} sleep - The wait between reads.
 * @returns {Promise<boolean>} Whether it completed in time.
 */
async function cancelled(ctx, id, sleep) {
    for (let waited = 0; ; waited += POLL_MS) {
        if ((await ctx.github.runView(id)).status === "completed") {
            return true;
        }
        if (waited >= POLL_LIMIT_MS) {
            return false;
        }
        await sleep(POLL_MS);
    }
}

/**
 * Act on a session's rerun request, as ops: only from a stage:qa session, at most
 * RERUN_LIMIT times a visit, and only as rerunAction allows. A refusal or a gh failure is
 * logged, never thrown.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue whose session asked.
 * @param {import("./requests.js").RerunRequest} request - The request.
 * @param {{sleep?: (ms: number) => Promise<void>}} [options] - The wait between reads of a cancelled run.
 * @returns {Promise<boolean>} Whether the run was rerun.
 */
export async function applyRerun(ctx, n, request, options = {}) {
    const {sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = options;
    const record = ctx.state.issues[n];
    const id = request.run;
    /**
     * @param {string} reason - Why the request is refused.
     * @returns {false} Nothing was rerun.
     */
    const refuse = reason => {
        ctx.log(`#${n}: refused rerun of run ${id}: ${reason}`);
        return false;
    };
    const stage = /** @type {any} */ (record.session)?.stage;
    if (stage !== "qa") {
        return refuse(`only a stage:qa session may ask for one, not a ${stage} session`);
    }
    const reruns = record.reruns ?? 0;
    if (reruns >= RERUN_LIMIT) {
        return refuse(`${RERUN_LIMIT} reruns already made in this visit to stage:qa`);
    }
    try {
        const decision = rerunAction({
            run: await ctx.github.runView(id),
            newer: await ctx.github.recentRuns(),
            issue: n,
            now: ctx.clock.now(),
            stuckAfterMs: STUCK_AFTER_MS
        });
        if ("refused" in decision) {
            return refuse(decision.refused);
        }
        if (decision.action === "cancel-rerun") {
            await ctx.github.cancelRun(id);
            if (!(await cancelled(ctx, id, sleep))) {
                return refuse("cancelled, but it did not complete within 60 s");
            }
        }
        await ctx.github.rerunRun(id);
    } catch (error) {
        ctx.log(`#${n}: rerun of run ${id} failed: ${String(error)}`);
        return false;
    }
    record.reruns = reruns + 1;
    ctx.log(`#${n}: reran run ${id} as ops (${record.reruns} of ${RERUN_LIMIT} this visit)`);
    return true;
}
