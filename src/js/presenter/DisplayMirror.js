/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EventEmitter} from "events";
import {MessageNames, Roles} from "../protocol/messages.js";
import {TransportStatus} from "../protocol/LocalTransport.js";
import {STOPPED_TIMER, elapsedAfter} from "../protocol/timer.js";
import {ON_FRAME} from "../protocol/camera.js";

/** @typedef {import("../protocol/camera.js").CameraView} CameraView */
/** @typedef {import("../protocol/layoutPresets.js").LayoutPreset} LayoutPreset */
/** @typedef {import("../protocol/messages.js").FrameInfo} FrameInfo */
/** @typedef {import("../protocol/messages.js").Message} Message */
/** @typedef {import("../protocol/timer.js").TimerState} TimerState */
/** @typedef {import("../protocol/viewport.js").Viewport} Viewport */

/** The events a display mirror emits.
 *
 * `change` carries the part of the mirror that changed, as an object of its fields.
 *
 * @readonly
 */
export const DisplayMirrorEvents = Object.freeze({change: "change"});

/** What the display last reported, for every panel of the presenter to read.
 *
 * The presenter holds no frame state of its own: a panel in a tab, on the rail or in the
 * narrow stack reads this one object and listens for its changes. The timer is the one thing
 * it works out for itself: it counts on from the display's last report, by this device's clock.
 *
 * @extends EventEmitter
 */
export class DisplayMirror extends EventEmitter {
    /** A mirror of a display that has reported nothing yet.
     *
     * @param {() => number} [now] - This device's time in milliseconds, from a clock that does
     *   not jump.
     */
    constructor(now = () => performance.now()) {
        super();
        this.now = now;

        /** How many frames the deck has.
         *
         * @type {number}
         */
        this.frameCount = 0;

        /** The position of the current frame, from 0.
         *
         * @type {number}
         */
        this.index = 0;

        /** The current frame, null until the display says hello.
         *
         * @type {?FrameInfo}
         */
        this.frame = null;

        /** Every frame in deck order, empty until the display says hello.
         *
         * @type {FrameInfo[]}
         */
        this.frames = [];

        /** The deck's id, empty until the display says hello.
         *
         * @type {string}
         */
        this.deckId = "";

        /** The date of the deck's page, empty until the display says hello.
         *
         * @type {string}
         */
        this.version = "";

        /** Is the blank screen shown?
         *
         * @type {boolean}
         */
        this.blank = false;

        /** The display's size, null until it has one.
         *
         * @type {?Viewport}
         */
        this.viewport = null;

        /** Can the presenter reach the display? One of `TransportStatus`.
         *
         * @type {string}
         */
        this.status = TransportStatus.connected;

        /** The deck's layout presets, in order, none until the display says hello.
         *
         * @type {Record<string, LayoutPreset>}
         */
        this.layouts = {};

        /** The talk timer, as the display last reported it.
         *
         * @type {Readonly<TimerState>}
         */
        this.timer = STOPPED_TIMER;

        /** Where the display's camera looks, relative to its current frame.
         *
         * @type {Readonly<CameraView>}
         */
        this.camera = ON_FRAME;

        /** When the timer's last report arrived, by this device's clock.
         *
         * @type {number}
         */
        this.timerArrivedAt = now();

        /** When the display was last reached, by this device's clock, once it cannot be.
         *
         * @type {number}
         */
        this.lostAt = this.timerArrivedAt;

        /** What each message from the display changes, by name (standard 2.5).
         *
         * @type {Readonly<Record<string, (message: any) => ?object>>}
         */
        this.readers = Object.freeze({
            [MessageNames.hello]: message => {
                if (message.role !== Roles.display) {
                    return null;
                }
                const {frameCount, blank, viewport, frame, frames, layouts, deckId, version} =
                    message;
                // A display without a size yet keeps the one it had.
                const part = viewport ? {frameCount, blank, viewport} : {frameCount, blank};
                return {
                    ...part,
                    frame,
                    frames,
                    index: frame.index,
                    layouts,
                    deckId,
                    version,
                    ...this.timerPart(message.timer),
                    camera: message.camera
                };
            },
            [MessageNames.frameChange]: ({index, id, title, notes}) => ({
                frame: {index, id, title, notes},
                index
            }),
            [MessageNames.viewport]: ({width, height, pixelRatio}) => ({
                viewport: {width, height, pixelRatio}
            }),
            [MessageNames.blank]: ({on}) => ({blank: on}),
            [MessageNames.timer]: ({elapsedMs, running, targetMs}) =>
                this.timerPart({elapsedMs, running, targetMs}),
            [MessageNames.camera]: ({offFrame, zoom, x, y}) => ({camera: {offFrame, zoom, x, y}})
        });
    }

    /** Note when a report of the timer arrived, and give the part it changes.
     *
     * @param {TimerState} timer - The timer as reported.
     * @returns {{timer: TimerState}} The part.
     */
    timerPart(timer) {
        this.timerArrivedAt = this.now();
        return {timer};
    }

    /** The time the timer has counted, as far as this surface can know: it stops counting
     * while the display cannot be reached.
     *
     * @param {number} [at] - The time to read it at, by this device's clock; by default, now.
     * @returns {number} The time counted, in milliseconds.
     */
    elapsedAt(at = this.now()) {
        const until = this.status === TransportStatus.connected ? at : this.lostAt;
        return elapsedAfter(this.timer, Math.max(until - this.timerArrivedAt, 0));
    }

    /** Take a message from the display; any other message changes nothing.
     *
     * @param {Message} message - A message read by `protocol/messages.js`.
     *
     * @fires DisplayMirrorEvents.change
     */
    apply(message) {
        const part = Object.hasOwn(this.readers, message.name)
            ? this.readers[message.name](message)
            : null;
        if (part) {
            this.change(part);
        }
    }

    /** Take the status of the transport to the display, and note when the display was lost,
     * as the timer stops counting there.
     *
     * @param {string} status - One of `TransportStatus`.
     *
     * @fires DisplayMirrorEvents.change
     */
    setStatus(status) {
        if (this.status === TransportStatus.connected) {
            this.lostAt = this.now();
        }
        this.change({status});
    }

    /** Copy a part into the mirror and tell the listeners.
     *
     * @param {object} part - The fields that changed.
     *
     * @fires DisplayMirrorEvents.change
     */
    change(part) {
        Object.assign(this, part);
        this.emit(DisplayMirrorEvents.change, part);
    }

    /** Remove every listener. */
    dispose() {
        this.removeAllListeners();
    }
}
