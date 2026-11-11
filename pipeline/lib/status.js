/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The --status report of the factory loop: the run, its sessions, and what waits.

import {pausedUntil} from "./limits.js";
import {loggedOutLines} from "./logins.js";

/** Name the harness and model a session runs on; nothing for one saved before they were.
 *
 * @param {{harness?: string, model?: string}} session - The session.
 * @returns {string} - The suffix, with its leading space.
 */
function onHarness(session) {
    return session.harness ? ` on ${session.harness} ${session.model}` : "";
}

/** A time without the milliseconds the state keeps.
 *
 * @param {string} iso - The time.
 * @returns {string} - The time to the second.
 */
function seconds(iso) {
    return iso.replace(/\.\d{3}Z$/, "Z");
}

/** One line per harness paused at its usage limit, and per issue whose session it stopped.
 *
 * @param {any} state - The loop state.
 * @param {Date} now - The current time.
 * @returns {string[]} - The lines.
 */
function limitLines(state, now) {
    const limits = state.run.limits ?? {};
    const lines = [];
    for (const harness of Object.keys(limits)) {
        const until = pausedUntil(limits, harness, now.getTime());
        if (until) {
            const {reported, streak} = limits[harness];
            const why = reported ? "reset reported" : `back-off, ${streak} in a row`;
            lines.push(`harness ${harness}: paused until ${seconds(until)} (${why})`);
        }
    }
    for (const [n, r] of Object.entries(state.issues)) {
        /** @type {any} */
        const record = r;
        const gone = record.interrupted;
        if (gone) {
            const until = pausedUntil(limits, gone.harness, now.getTime());
            const when = until ? seconds(until) : "next pass";
            lines.push(`#${n} ${record.stage}: interrupted on ${gone.harness}, resumes ${when}`);
        }
    }
    return lines;
}

/** Describe the state for --status: the run, sessions, paused harnesses, interrupted issues,
 * tries, waits, queues, dead letters and logged-out personas.
 *
 * @param {any} state - The loop state.
 * @param {Date} [now] - The current time, which tells a pause that ended from one that holds.
 * @returns {string} - The report.
 */
export function statusText(state, now = new Date()) {
    const run = state.run;
    const lines = [
        `run: started ${run.started ?? "never"}${run.stopped ? " (stopped)" : ""}`,
        `until: ${run.until ?? "-"}  epic: ${run.epic ? `#${run.epic}` : "-"}`,
        `totals: ${run.tokens} tokens, $${Number(run.costUsd).toFixed(2)}`
    ];
    for (const [n, r] of Object.entries(state.issues)) {
        /** @type {any} */
        const record = r;
        const session = record.session;
        if (session) {
            lines.push(
                `#${n} ${session.stage}: ${session.container} since ${session.started}${onHarness(session)}`
            );
        }
    }
    for (const s of run.sessions ?? []) {
        lines.push(`spawn ${s.persona}: ${s.container} since ${s.started}${onHarness(s)}`);
    }
    lines.push(...limitLines(state, now));
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
        const others = ["codex", "agy"]
            .filter(h => /** @type {any} */ (info)[h]?.loggedIn)
            .map(h => `; ${h} logged in`)
            .join("");
        if (!info.claude.loggedIn) {
            return `profile ${persona}: claude not logged in${others}`;
        }
        const servers = info.claude.servers.length
            ? `, servers: ${info.claude.servers.join(", ")}`
            : "";
        return `profile ${persona}: claude logged in${servers}${others}`;
    });
    return `${lines.join("\n")}\n`;
}
