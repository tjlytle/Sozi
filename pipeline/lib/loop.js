/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The loop around the pass: watching with an idle back-off, SIGINT and SIGTERM handling,
// and waiting for the sessions the loop started before it lets go of the mint endpoint.

const FIRST_DELAY_S = 30;
const MAX_DELAY_S = 600;
const POLL_S = 15;
// npm passes the terminal's Ctrl-C on to the loop a second time; a copy this close to
// the signal it follows is the same press.
const REPEAT_MS = 1000;

/**
 * @typedef {(options?: {start?: boolean}) => Promise<import("./sync.js").Summary>} Pass
 */

/**
 * @typedef {object} Control
 * @property {boolean} stopping - A first signal came: finish the pass, start nothing.
 * @property {boolean} draining - The loop waits for its sessions; a signal now leaves.
 * @property {(seconds: number) => Promise<void>} pause - Waits, cut short by a signal.
 * @property {() => void} interrupt - What a SIGINT or SIGTERM does.
 */

/**
 * Name each session the loop started: `#n stage (container)` for an issue session and
 * `spawn #n (container)` for a spawn.
 *
 * @param {any} state - The loop state.
 * @returns {string[]} The names.
 */
export function sessionNames(state) {
    const issues = Object.entries(state.issues)
        .filter(([, r]) => r.session)
        .map(([n, r]) => `#${n} ${r.session.stage} (${r.session.container})`);
    const spawns = (state.run.sessions ?? []).map(
        (/** @type {any} */ s) => `spawn ${s.issue ? `#${s.issue}` : s.persona} (${s.container})`
    );
    return [...issues, ...spawns];
}

/**
 * Hook SIGINT and SIGTERM, passing the signal name to the handler.
 *
 * @param {(signal: string) => void} handler - What a signal does.
 * @param {import("node:events").EventEmitter} [proc] - Where signals come from.
 * @returns {() => void} The unhook.
 */
export function hookSignals(handler, proc = process) {
    const signals = ["SIGINT", "SIGTERM"];
    for (const signal of signals) {
        proc.on(signal, handler);
    }
    return () => {
        for (const signal of signals) {
            proc.off(signal, handler);
        }
    };
}

/**
 * Create the control the watch loop and the signals share. A first signal stops the
 * loop after its pass; a second one, at least a second later, saves and leaves.
 *
 * @param {object} options - How to wait and how to leave.
 * @param {((seconds: number) => Promise<void>) | undefined} options.sleep - A wait to use instead of a timer.
 * @param {() => void} options.save - Writes the state.
 * @param {(code: number) => void} options.exit - Ends the process.
 * @param {(line: string) => void} options.log - The log.
 * @param {any} options.state - The loop state, to name the sessions left running.
 * @param {() => number} [options.now] - The clock, in milliseconds.
 * @returns {Control} The control.
 */
export function createControl({sleep, save, exit, log, state, now = Date.now}) {
    let wake = () => {};
    let last = -Infinity;
    /** @type {Control} */
    const control = {
        stopping: false,
        draining: false,
        pause(seconds) {
            if (sleep) {
                return sleep(seconds);
            }
            return new Promise(resolve => {
                const timer = setTimeout(resolve, seconds * 1000);
                wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
            });
        },
        interrupt() {
            const t = now();
            if (t - last < REPEAT_MS) {
                return;
            }
            last = t;
            if (control.stopping || control.draining) {
                save();
                const left = sessionNames(state).join(", ") || "no sessions";
                log(`leaving ${left}; they are judged at the next start`);
                exit(130);
                return;
            }
            control.stopping = true;
            log("stopping after this pass; signal again to leave running sessions");
            wake();
        }
    };
    return control;
}

/**
 * Pass after pass until the stop condition holds or a signal, backing off while nothing
 * happens. A pass that throws is logged and the state saved; the loop goes on.
 *
 * @param {Pass} pass - The pass.
 * @param {Control} control - The control.
 * @param {(line: string) => void} log - The log.
 * @param {() => void} save - Writes the state.
 * @returns {Promise<string | null>} Why the run stopped, or null after a signal.
 */
export async function watch(pass, control, log, save) {
    let delay = FIRST_DELAY_S;
    while (!control.stopping) {
        let busy = false;
        try {
            const s = await pass();
            if (s.stopped) {
                return s.stopped;
            }
            busy = s.started.length + s.finished.length + s.spawns > 0;
        } catch (error) {
            log(`pass failed: ${String(error)}`);
            save();
        }
        if (control.stopping) {
            break;
        }
        delay = busy ? FIRST_DELAY_S : Math.min(delay * 2, MAX_DELAY_S);
        await control.pause(delay);
    }
    return null;
}

/**
 * Wait until every session the loop started has ended, judging each and naming the ones
 * still running, so the mint endpoint stays up while a container may still need a token.
 *
 * @param {Pass} pass - The pass.
 * @param {any} state - The loop state.
 * @param {Control} control - The control.
 * @param {(line: string) => void} log - The log.
 * @returns {Promise<void>}
 */
export async function drain(pass, state, control, log) {
    control.draining = true;
    for (let names = sessionNames(state); names.length > 0; names = sessionNames(state)) {
        log(`waiting for ${names.join(", ")}; signal again to leave them`);
        await control.pause(POLL_S);
        try {
            await pass({start: false});
        } catch (error) {
            log(`pass failed: ${String(error)}`);
        }
    }
}
