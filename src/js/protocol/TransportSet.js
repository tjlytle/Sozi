/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EventEmitter} from "events";
import {TransportEvents, TransportStatus} from "./LocalTransport.js";

/** Every status a transport can have, best first.
 *
 * @readonly
 */
const STATUS_ORDER = Object.freeze([
    TransportStatus.connected,
    TransportStatus.reconnecting,
    TransportStatus.stale,
    TransportStatus.closed
]);

/**
 * What a member of a set has: `LocalTransport`, or an add-on's transport with the same shape.
 *
 * @typedef {object} Transport
 * @property {string} status - Can it reach the other end?
 * @property {(message: object) => boolean} send - Send a message; false if it could not.
 * @property {(handler: (data: any) => void) => () => void} onMessage - Hear each message;
 *   returns a function that stops.
 * @property {(event: string, listener: (status: string) => void) => void} on - Listen for
 *   `TransportEvents.statusChange`.
 * @property {(event: string, listener: (status: string) => void) => void} off - Stop listening.
 * @property {() => void} dispose - Close it.
 */

/** Several transports that act as one.
 *
 * The display broadcasts, so that every link hears what it reports. A surface sends each
 * command to its primary alone: `next` sent on two links to one display would move two
 * frames. Both hear from every member.
 *
 * @extends EventEmitter
 */
export class TransportSet extends EventEmitter {
    /** A set with no members, whose status is `closed`. */
    constructor() {
        super();

        /** The members, in the order they were added, each with what stops listening to it.
         *
         * @type {{transport: Transport, stop: () => void}[]}
         */
        this.members = [];

        /** The functions that hear each message.
         *
         * @type {Set<(data: any, transport: Transport) => void>}
         */
        this.handlers = new Set();

        /** The status last reported to the listeners.
         *
         * @type {string}
         */
        this.lastStatus = this.status;
    }

    /** Add a member; it is the primary from now on, if it is connected.
     *
     * @param {Transport} transport - The transport.
     *
     * @fires TransportEvents.statusChange
     */
    add(transport) {
        const onStatus = () => this.reportStatus();
        const stopHearing = transport.onMessage(data => {
            for (const handler of this.handlers) {
                handler(data, transport);
            }
        });
        transport.on(TransportEvents.statusChange, onStatus);
        const stop = () => {
            stopHearing();
            transport.off(TransportEvents.statusChange, onStatus);
        };
        this.members.push({transport, stop});
        this.reportStatus();
    }

    /** Send a message on every member.
     *
     * @param {object} message - A message built by `protocol/`.
     */
    broadcast(message) {
        for (const {transport} of this.members) {
            transport.send(message);
        }
    }

    /** Send a message on the most recently added connected member.
     *
     * @param {object} message - A message built by `protocol/`.
     * @returns {boolean} True if it was sent; false when no member is connected.
     */
    sendToPrimary(message) {
        const primary = this.members
            .map(member => member.transport)
            .reverse()
            .find(transport => transport.status === TransportStatus.connected);
        return primary ? primary.send(message) : false;
    }

    /** Call a function with the data of every message from any member.
     *
     * @param {(data: any, transport: Transport) => void} handler - The function; it is told
     *   which member the message came from.
     * @returns {() => void} A function that stops the calls.
     */
    onMessage(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    /** The best status of the members, `closed` when there are none.
     *
     * @readonly
     * @type {string}
     */
    get status() {
        const statuses = this.members.map(member => member.transport.status);
        return STATUS_ORDER.find(status => statuses.includes(status)) || TransportStatus.closed;
    }

    /** Tell the listeners if the combined status has changed.
     *
     * @fires TransportEvents.statusChange
     */
    reportStatus() {
        const status = this.status;
        if (status !== this.lastStatus) {
            this.lastStatus = status;
            this.emit(TransportEvents.statusChange, status);
        }
    }

    /** Stop listening to every member, dispose it, and remove every listener. */
    dispose() {
        for (const {transport, stop} of this.members) {
            stop();
            transport.dispose();
        }
        this.members = [];
        this.handlers.clear();
        this.removeAllListeners();
    }
}
