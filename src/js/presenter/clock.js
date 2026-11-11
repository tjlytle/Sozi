/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** What the Clock panel says about a time: its text, its colour and the target field.
 *
 * @module
 */

/** A minute in milliseconds.
 *
 * @readonly
 * @default
 * @type {number}
 */
export const MINUTE_MS = 60000;

/** The share of the target from which the digits change colour.
 *
 * @readonly
 * @default
 * @type {number}
 */
const NEAR_SHARE = 0.8;

/** A second in milliseconds.
 *
 * @readonly
 * @default
 * @type {number}
 */
const SECOND_MS = 1000;

/** How the elapsed time stands against the target.
 *
 * @readonly
 */
export const TimerPhases = Object.freeze({normal: "normal", near: "near", over: "over"});

/**
 * Pad a part of a time to two digits.
 *
 * @param {number} part - The part.
 * @returns {string} Its text.
 */
function twoDigits(part) {
    return String(part).padStart(2, "0");
}

/**
 * The text of a duration: `MM:SS`, then `H:MM:SS` from one hour. A part of a second is not shown.
 *
 * @param {number} ms - The duration, in milliseconds.
 * @returns {string} The text.
 */
export function formatDuration(ms) {
    const seconds = Math.floor(ms / SECOND_MS);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const clock = `${twoDigits(minutes % 60)}:${twoDigits(seconds % 60)}`;
    return hours > 0 ? `${hours}:${clock}` : clock;
}

/**
 * How much of the target is left, or how far past it the talk is.
 *
 * The time left rounds up, so that it and the elapsed time on screen add up to the target.
 *
 * @param {number} elapsedMs - The time counted.
 * @param {?number} targetMs - The target length, null with none.
 * @returns {string} `04:12 left` or `02:00 over`; empty with no target.
 */
export function remainingText(elapsedMs, targetMs) {
    if (targetMs === null) {
        return "";
    }
    if (elapsedMs >= targetMs) {
        return `${formatDuration(elapsedMs - targetMs)} over`;
    }
    const left = Math.ceil((targetMs - elapsedMs) / SECOND_MS) * SECOND_MS;
    return `${formatDuration(left)} left`;
}

/**
 * How the elapsed time stands against the target.
 *
 * @param {number} elapsedMs - The time counted.
 * @param {?number} targetMs - The target length, null with none.
 * @returns {string} One of `TimerPhases`.
 */
export function timerPhase(elapsedMs, targetMs) {
    if (targetMs === null || elapsedMs < targetMs * NEAR_SHARE) {
        return TimerPhases.normal;
    }
    return elapsedMs < targetMs ? TimerPhases.near : TimerPhases.over;
}

/**
 * Read the text of the target field.
 *
 * A number of minutes too long to time in milliseconds is not a target.
 *
 * @param {string} text - The text.
 * @returns {number | null | undefined} The minutes; null for an empty field, which clears the
 *   target; undefined for anything that is not a target.
 */
export function readTargetMinutes(text) {
    const trimmed = text.trim();
    if (trimmed === "") {
        return null;
    }
    const minutes = /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : NaN;
    return Number.isFinite(minutes * MINUTE_MS) && minutes > 0 ? minutes : undefined;
}

/**
 * The text of the target field for a target.
 *
 * @param {?number} targetMs - The target length, null with none.
 * @returns {string} The minutes; empty with no target.
 */
export function targetFieldText(targetMs) {
    return targetMs === null ? "" : String(targetMs / MINUTE_MS);
}
