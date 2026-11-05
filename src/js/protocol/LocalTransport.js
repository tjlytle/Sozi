/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EventEmitter} from "events";

/** How often the transport looks whether its target window was closed, in milliseconds.
 *
 * @readonly
 * @default
 * @type {number}
 */
const CLOSED_CHECK_MS = 1000;

/** The events a transport emits.
 *
 * `message` carries the data of a message from the target; `statusChange` the new status.
 *
 * @readonly
 */
export const TransportEvents = Object.freeze({message: "message", statusChange: "statusChange"});

/** The status of a transport: it can reach its target, or the target is gone.
 *
 * @readonly
 */
export const TransportStatus = Object.freeze({open: "open", closed: "closed"});

/**
 * The parts of a window a transport uses.
 *
 * @typedef {object} TransportWindow
 * @property {boolean} closed - Has the window been closed?
 * @property {(message: any, targetOrigin: string) => void} postMessage - Post to it.
 * @property {(type: "message", listener: (evt: any) => void) => void} addEventListener - Listen on it.
 * @property {(type: "message", listener: (evt: any) => void) => void} removeEventListener - Stop listening.
 * @property {(callback: () => void, ms: number) => number} setInterval - Start a timer.
 * @property {(id: number) => void} clearInterval - Stop a timer.
 */

/** A link to one other window in the same browser, over `postMessage`.
 *
 * It hands on only the messages whose source is its target, and it posts with `"*"`
 * because a deck opened from a file has an opaque origin. Bound to its own window (a deck
 * that is not in a presenter), it posts nothing and still hands on what the page posts to
 * itself. It never reads a message: `protocol/messages.js` does.
 *
 * @extends EventEmitter
 */
export class LocalTransport extends EventEmitter {
    /** Bind a transport to a target window.
     *
     * @param {TransportWindow} host - The window this code runs in.
     * @param {TransportWindow} target - The window at the other end.
     */
    constructor(host, target) {
        super();

        /** The window this code runs in.
         *
         * @type {TransportWindow}
         */
        this.host = host;

        /** The window at the other end.
         *
         * @type {TransportWindow}
         */
        this.target = target;

        /** Can the transport reach its target?
         *
         * @type {string}
         */
        this.status = TransportStatus.open;

        /** The message listener on the host, kept so that `dispose` can remove it.
         *
         * @param {MessageEvent} evt - A message event on the host.
         */
        this.onHostMessage = evt => {
            if (evt.source === this.target) {
                this.emit(TransportEvents.message, evt.data);
            }
        };
        host.addEventListener("message", this.onHostMessage);

        /** The timer that looks for a closed target, or null when there is none.
         *
         * @type {?number}
         */
        this.closedTimer = this.receiveOnly
            ? null
            : host.setInterval(() => this.checkClosed(), CLOSED_CHECK_MS);
    }

    /** Is the transport bound to its own window, so that it never posts?
     *
     * @readonly
     * @type {boolean}
     */
    get receiveOnly() {
        return this.target === this.host;
    }

    /** Post a message to the target.
     *
     * @param {import("./messages.js").Message | object} message - A message built by `protocol/`.
     * @returns {boolean} True if it was posted; false when receive-only or closed.
     */
    send(message) {
        this.checkClosed();
        if (this.receiveOnly || this.status !== TransportStatus.open) {
            return false;
        }
        this.target.postMessage(message, "*");
        return true;
    }

    /** Call a function with the data of every message from the target.
     *
     * @param {(data: any) => void} handler - The function.
     * @returns {() => void} A function that stops the calls.
     */
    onMessage(handler) {
        this.on(TransportEvents.message, handler);
        return () => this.off(TransportEvents.message, handler);
    }

    /** Move to `closed` if the target was closed.
     *
     * @fires TransportEvents.statusChange
     */
    checkClosed() {
        if (this.status === TransportStatus.open && this.target.closed) {
            this.setStatus(TransportStatus.closed);
        }
    }

    /** Change the status and tell the listeners.
     *
     * @param {string} status - The new status.
     *
     * @fires TransportEvents.statusChange
     */
    setStatus(status) {
        this.status = status;
        this.emit(TransportEvents.statusChange, status);
    }

    /** Remove the listener and the timer; the transport sends nothing after this. */
    dispose() {
        this.host.removeEventListener("message", this.onHostMessage);
        if (this.closedTimer !== null) {
            this.host.clearInterval(this.closedTimer);
            this.closedTimer = null;
        }
        this.status = TransportStatus.closed;
        this.removeAllListeners();
    }
}
