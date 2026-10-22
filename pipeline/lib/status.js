/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The --status report of the factory loop: the run, its sessions, and what waits.

/** Describe the state for --status: the run, sessions, tries, waits, queues and dead
 * letters.
 *
 * @param {any} state - The loop state.
 * @returns {string} - The report.
 */
export function statusText(state) {
    const run = state.run;
    const lines = [
        `run: started ${run.started ?? "never"}${run.stopped ? " (stopped)" : ""}`,
        `until: ${run.until ?? "-"}  epic: ${run.epic ? `#${run.epic}` : "-"}`,
        `totals: ${run.tokens} tokens, $${Number(run.costUsd).toFixed(2)}`
    ];
    for (const [n, r] of Object.entries(state.issues)) {
        /** @type {any} */
        const record = r;
        if (record.session) {
            lines.push(
                `#${n} ${record.session.stage}: ${record.session.container} since ${record.session.started}`
            );
        }
    }
    for (const s of run.sessions ?? []) {
        lines.push(`spawn ${s.persona}: ${s.container} since ${s.started}`);
    }
    for (const [n, r] of Object.entries(state.issues)) {
        /** @type {any} */
        const record = r;
        if (record.tries > 0 || record.waiting || record.stage === "stage:parked") {
            const what = record.waiting ? "waiting for a person" : `${record.tries} tries`;
            lines.push(`#${n} ${record.stage}: ${what}`);
        }
    }
    lines.push(`queued labels: ${state.queued.length}`);
    for (const q of state.queued) {
        lines.push(
            q.comment
                ? `  #${q.comment.issue} comment as ${q.comment.persona}`
                : `  #${q.issue} +${q.add.join(",")} -${q.remove.join(",")}`
        );
    }
    lines.push(`dead letters: ${(state.deadLetters ?? []).length}`);
    for (const d of state.deadLetters ?? []) {
        lines.push(`  ${JSON.stringify(d.op)}: ${d.error}`);
    }
    lines.push(`queued spawns: ${(run.spawns ?? []).length}`);
    return `${lines.join("\n")}\n`;
}
