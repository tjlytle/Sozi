/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The --status report of the factory loop: the run, its sessions, and what waits.

import {loggedOutLines} from "./logins.js";

/** Describe the state for --status: the run, sessions, tries, waits, queues, dead
 * letters and logged-out personas.
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
    lines.push(...loggedOutLines(state));
    return `${lines.join("\n")}\n`;
}

/** Describe each persona profile for --status, never a value from it.
 *
 * @param {Array<{persona: string, info: import("./profile.js").ProfileInfo | null | Error}>} infos - What each inspection found; an Error when it failed.
 * @returns {string} - One line per persona.
 */
export function profilesText(infos) {
    const lines = infos.map(({persona, info}) => {
        if (info instanceof Error) {
            return `profile ${persona}: unknown (${info.message.split("\n")[0].slice(0, 80)})`;
        }
        if (!info) {
            return `profile ${persona}: none`;
        }
        if (!info.claude.loggedIn) {
            return `profile ${persona}: claude not logged in`;
        }
        const servers = info.claude.servers.length
            ? `, servers: ${info.claude.servers.join(", ")}`
            : "";
        return `profile ${persona}: claude logged in${servers}`;
    });
    return `${lines.join("\n")}\n`;
}
