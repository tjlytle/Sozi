/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The loop around the pass: watching with an idle back-off, Ctrl-C handling, and
// waiting for the sessions the loop started before it lets go of the mint endpoint.

const FIRST_DELAY_S = 30;
const MAX_DELAY_S = 600;
const POLL_S = 15;

/**
 * @typedef {(options?: {start?: boolean}) => Promise<import("./sync.js").Summary>} Pass
 */

/**
 * @typedef {object} Control
 * @property {boolean} stopping - Ctrl-C was pressed once: finish the pass, start nothing.
 * @property {boolean} draining - The loop waits for its sessions; Ctrl-C now leaves.
 * @property {(seconds: number) => Promise<void>} pause - Waits, cut short by Ctrl-C.
 * @property {() => void} interrupt - What Ctrl-C does.
 */

/**
 * Create the control the watch loop and Ctrl-C share.
 *
 * @param {object} options - How to wait and how to leave.
 * @param {((seconds: number) => Promise<void>) | undefined} options.sleep - A wait to use instead of a timer.
 * @param {() => void} options.save - Writes the state.
 * @param {(code: number) => void} options.exit - Ends the process.
 * @param {(line: string) => void} options.log - The log.
 * @returns {Control} The control.
 */
export function createControl({sleep, save, exit, log}) {
    let wake = () => {};
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
            if (control.stopping || control.draining) {
                save();
                log("leaving; running sessions are judged at the next start");
                exit(130);
                return;
            }
            control.stopping = true;
            log("stopping after this pass; Ctrl-C again to leave running sessions");
            wake();
        }
    };
    return control;
}

/**
 * Pass after pass until the stop condition holds or Ctrl-C, backing off while nothing
 * happens. A pass that throws is logged and the state saved; the loop goes on.
 *
 * @param {Pass} pass - The pass.
 * @param {Control} control - The control.
 * @param {(line: string) => void} log - The log.
 * @param {() => void} save - Writes the state.
 * @returns {Promise<string | null>} Why the run stopped, or null after Ctrl-C.
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
 * Wait until every session the loop started has ended, judging each, so the mint
 * endpoint stays up while a container may still need a token.
 *
 * @param {Pass} pass - The pass.
 * @param {any} state - The loop state.
 * @param {Control} control - The control.
 * @param {(line: string) => void} log - The log.
 * @returns {Promise<void>}
 */
export async function drain(pass, state, control, log) {
    control.draining = true;
    const running = () =>
        Object.values(state.issues).filter((/** @type {any} */ r) => r.session).length +
        (state.run.sessions ?? []).length;
    for (let n = running(); n > 0; n = running()) {
        log(`waiting for ${n} sessions; Ctrl-C again to leave them`);
        await control.pause(POLL_S);
        try {
            await pass({start: false});
        } catch (error) {
            log(`pass failed: ${String(error)}`);
        }
    }
}
