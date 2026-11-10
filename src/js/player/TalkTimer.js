/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EventEmitter} from "events";

/** @typedef {import("../protocol/timer.js").TimerState} TimerState */

/** The events a talk timer emits.
 *
 * `change` says the timer was started, paused or reset, or its target changed.
 *
 * @readonly
 */
export const TalkTimerEvents = Object.freeze({change: "change"});

/** How long the talk has been running, kept on the display so that every surface agrees.
 *
 * It starts on the first frame change, or earlier when asked. It sets no interval: the time
 * counted is computed when it is read.
 *
 * @extends EventEmitter
 */
export class TalkTimer extends EventEmitter {
    /** A timer that has counted nothing.
     *
     * @param {() => number} now - The time in milliseconds, from a clock that does not jump.
     */
    constructor(now) {
        super();
        this.now = now;

        /** The time counted up to the last pause, in milliseconds.
         *
         * @type {number}
         */
        this.counted = 0;

        /** When it last started counting, null while it is not.
         *
         * @type {?number}
         */
        this.startedAt = null;

        /** The target length in milliseconds, null with none.
         *
         * @type {?number}
         */
        this.targetMs = null;

        /** Will the next frame change start it? Until it is started, and again after a reset.
         *
         * @type {boolean}
         */
        this.armed = true;
    }

    /** The timer as it is now.
     *
     * @readonly
     * @type {TimerState}
     */
    get state() {
        const {counted, startedAt, targetMs} = this;
        return startedAt === null
            ? {elapsedMs: counted, running: false, targetMs}
            : {elapsedMs: counted + this.now() - startedAt, running: true, targetMs};
    }

    /** Start counting, or carry on from a pause.
     *
     * @fires TalkTimerEvents.change
     */
    start() {
        this.armed = false;
        if (this.startedAt === null) {
            this.startedAt = this.now();
            this.emit(TalkTimerEvents.change);
        }
    }

    /** Stop counting, and keep the time counted; a frame change does not start it again.
     *
     * @fires TalkTimerEvents.change
     */
    pause() {
        if (this.startedAt !== null) {
            this.counted = this.state.elapsedMs;
            this.startedAt = null;
            this.emit(TalkTimerEvents.change);
        }
    }

    /** Go back to zero, stopped, with the next frame change to start it. The target stays.
     *
     * @fires TalkTimerEvents.change
     */
    reset() {
        this.counted = 0;
        this.startedAt = null;
        this.armed = true;
        this.emit(TalkTimerEvents.change);
    }

    /** Set the target length, or clear it.
     *
     * @param {?number} ms - The length in milliseconds, null for none.
     *
     * @fires TalkTimerEvents.change
     */
    setTarget(ms) {
        this.targetMs = ms;
        this.emit(TalkTimerEvents.change);
    }

    /** Take a frame change: the first starts the timer. */
    frameChanged() {
        if (this.armed) {
            this.start();
        }
    }

    /** Remove every listener. */
    dispose() {
        this.removeAllListeners();
    }
}
