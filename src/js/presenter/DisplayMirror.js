/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EventEmitter} from "events";
import {MessageNames, Roles} from "../protocol/messages.js";
import {TransportStatus} from "../protocol/LocalTransport.js";

/** @typedef {import("../protocol/messages.js").FrameInfo} FrameInfo */
/** @typedef {import("../protocol/messages.js").Message} Message */
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
 * narrow stack reads this one object and listens for its changes.
 *
 * @extends EventEmitter
 */
export class DisplayMirror extends EventEmitter {
    /** A mirror of a display that has reported nothing yet. */
    constructor() {
        super();

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

        /** What each message from the display changes, by name (standard 2.5).
         *
         * @type {Readonly<Record<string, (message: any) => ?object>>}
         */
        this.readers = Object.freeze({
            [MessageNames.hello]: message => {
                if (message.role !== Roles.display) {
                    return null;
                }
                const {frameCount, blank, viewport, frame} = message;
                // A display without a size yet keeps the one it had.
                const part = viewport ? {frameCount, blank, viewport} : {frameCount, blank};
                return {...part, frame, index: frame.index};
            },
            [MessageNames.frameChange]: ({index, id, title, notes}) => ({
                frame: {index, id, title, notes},
                index
            }),
            [MessageNames.viewport]: ({width, height, pixelRatio}) => ({
                viewport: {width, height, pixelRatio}
            }),
            [MessageNames.blank]: ({on}) => ({blank: on})
        });
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

    /** Take the status of the transport to the display.
     *
     * @param {string} status - One of `TransportStatus`.
     *
     * @fires DisplayMirrorEvents.change
     */
    setStatus(status) {
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
