/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The messages a display and its surfaces exchange about the talk timer.
 *
 * `readMessage` in `messages.js` reads them too.
 *
 * @module
 */

/**
 * The talk timer as the display reports it.
 *
 * @typedef {object} TimerState
 * @property {number} elapsedMs - The time counted so far, in milliseconds.
 * @property {boolean} running - Is it counting?
 * @property {number | null} targetMs - The target length in milliseconds, null with none.
 */

/** @typedef {{name: "timer"} & TimerState} TimerMessage */
/** @typedef {{name: "timerAction", action: string}} TimerActionMessage */
/** @typedef {{name: "timerTarget", targetMs: number | null}} TimerTargetMessage */

/** What a surface can ask the timer to do.
 *
 * @readonly
 */
export const TimerActions = Object.freeze({start: "start", pause: "pause", reset: "reset"});

/** A timer that has counted nothing: what a surface holds until a display reports one, and
 * what a deck from before the timer reads as.
 *
 * @readonly
 * @type {Readonly<TimerState>}
 */
export const STOPPED_TIMER = Object.freeze({elapsedMs: 0, running: false, targetMs: null});

/**
 * Build a `timer`: the timer has changed.
 *
 * @param {TimerState} state - The timer as it is now.
 * @returns {TimerMessage} The message.
 */
export function timerMessage({elapsedMs, running, targetMs}) {
    return {name: "timer", elapsedMs, running, targetMs};
}

/**
 * Build a `timerAction`: start, pause or reset the timer.
 *
 * @param {string} action - One of `TimerActions`.
 * @returns {TimerActionMessage} The message.
 */
export function timerActionMessage(action) {
    return {name: "timerAction", action};
}

/**
 * Build a `timerTarget`: set the target length, or clear it.
 *
 * @param {number | null} targetMs - The length in milliseconds, null for none.
 * @returns {TimerTargetMessage} The message.
 */
export function timerTargetMessage(targetMs) {
    return {name: "timerTarget", targetMs};
}

/**
 * Is it a target: a positive length, or null for none?
 *
 * @param {any} v - The value.
 * @returns {boolean} True for a positive finite number or null.
 */
function isTarget(v) {
    return v === null || (typeof v === "number" && Number.isFinite(v) && v > 0);
}

/**
 * Read a received timer state.
 *
 * @param {any} data - The fields of a timer.
 * @returns {TimerState | null} The state, or null if a field is malformed.
 */
export function readTimerState(data) {
    if (data === null || typeof data !== "object") {
        return null;
    }
    const {elapsedMs, running, targetMs} = data;
    const valid =
        typeof elapsedMs === "number" &&
        Number.isFinite(elapsedMs) &&
        elapsedMs >= 0 &&
        typeof running === "boolean" &&
        isTarget(targetMs);
    return valid ? {elapsedMs, running, targetMs} : null;
}

/**
 * Read a received `timer`.
 *
 * @param {any} data - The message.
 * @returns {TimerMessage | null} The message, or null if a field is malformed.
 */
export function readTimer(data) {
    const state = readTimerState(data);
    return state && timerMessage(state);
}

/**
 * Read a received `timerAction`.
 *
 * @param {any} data - The message.
 * @returns {TimerActionMessage | null} The message, or null for an action there is not.
 */
export function readTimerAction({action}) {
    return Object.values(TimerActions).includes(action) ? timerActionMessage(action) : null;
}

/**
 * Read a received `timerTarget`.
 *
 * @param {any} data - The message.
 * @returns {TimerTargetMessage | null} The message, or null if it is not a target.
 */
export function readTimerTarget({targetMs}) {
    return isTarget(targetMs) ? timerTargetMessage(targetMs) : null;
}

/**
 * The time a timer has counted some time after it reported its state.
 *
 * Devices' clocks disagree, so a surface adds the time since the state arrived, by its own
 * clock, to what the display said.
 *
 * @param {TimerState} state - The timer as reported.
 * @param {number} ms - The time since then, in milliseconds.
 * @returns {number} The time counted, in milliseconds.
 */
export function elapsedAfter({elapsedMs, running}, ms) {
    return running ? elapsedMs + ms : elapsedMs;
}
