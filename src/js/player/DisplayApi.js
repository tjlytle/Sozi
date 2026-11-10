/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EventEmitter} from "events";
import {DisplayChannelEvents} from "./DisplayChannel.js";

/** @typedef {import("./DisplayChannel.js").DisplayChannel} DisplayChannel */
/** @typedef {import("./PairingOverlay.js").PairingOverlay} PairingOverlay */
/** @typedef {import("./PairingOverlay.js").Pairing} Pairing */
/** @typedef {import("../protocol/TransportSet.js").Transport} Transport */

/** The events `sozi.display` emits.
 *
 * `custom` carries the `type` and `data` of a `custom` message from a surface.
 *
 * @readonly
 */
export const DisplayApiEvents = Object.freeze({custom: DisplayChannelEvents.custom});

/** What the page publishes as `window.sozi.display`: the API of the presentation page.
 *
 * It exists when the module loads, because custom scripts run before `load`. A call made
 * before `start` waits there, in the order it came.
 */
export class DisplayApi {
    /** An API with no channel yet. */
    constructor() {
        /** Where the events go; a handler sees only `on` and `off`.
         *
         * @type {EventEmitter}
         */
        this.events = new EventEmitter();

        /** The channel and the overlay, null until `start`.
         *
         * @type {?{channel: DisplayChannel, overlay: PairingOverlay}}
         */
        this.deck = null;

        /** What was called before `start`, in order.
         *
         * @type {((deck: {channel: DisplayChannel, overlay: PairingOverlay}) => void)[]}
         */
        this.pending = [];

        this.onCustom = (type, data) => this.events.emit(DisplayApiEvents.custom, type, data);
    }

    /** Add a link for the surfaces to reach this display on; it gets the display's `hello`.
     *
     * @param {Transport} transport - The transport.
     */
    registerTransport(transport) {
        this.whenStarted(({channel}) => channel.addTransport(transport));
    }

    /** Send a message to the surfaces' add-ons.
     *
     * @param {string} name - The add-on's name for the message.
     * @param {any} payload - Its content.
     */
    send(name, payload) {
        this.whenStarted(({channel}) => channel.sendCustom(name, payload));
    }

    /** Call a function on an event.
     *
     * @param {string} name - One of `DisplayApiEvents`.
     * @param {(type: string, data: any) => void} handler - The function.
     * @throws {TypeError} If there is no such event.
     */
    on(name, handler) {
        if (!Object.hasOwn(DisplayApiEvents, name)) {
            throw new TypeError(`The display has no event "${name}"`);
        }
        this.events.on(name, handler);
    }

    /** Stop calling a function on an event.
     *
     * @param {string} name - One of `DisplayApiEvents`.
     * @param {(type: string, data: any) => void} handler - The function.
     */
    off(name, handler) {
        this.events.off(name, handler);
    }

    /** Say what the pairing shortcut shows; a second pairing replaces the first.
     *
     * @param {Pairing} pairing - The pairing.
     * @throws {TypeError} If it has no render function.
     */
    registerPairing(pairing) {
        if (!pairing || typeof pairing.render !== "function") {
            throw new TypeError("A pairing needs a render function");
        }
        this.whenStarted(({overlay}) => overlay.setPairing(pairing));
    }

    /** Give the API its channel and overlay, and do what waited for them.
     *
     * @param {DisplayChannel} channel - The display's channel, already started.
     * @param {PairingOverlay} overlay - The pairing overlay.
     */
    start(channel, overlay) {
        this.deck = {channel, overlay};
        channel.on(DisplayChannelEvents.custom, this.onCustom);
        for (const call of this.pending.splice(0)) {
            call(this.deck);
        }
    }

    /** Remove every listener it added. */
    dispose() {
        if (this.deck) {
            this.deck.channel.off(DisplayChannelEvents.custom, this.onCustom);
        }
        this.events.removeAllListeners();
    }

    /** Do something now if the channel is there, or when it comes.
     *
     * @param {(deck: {channel: DisplayChannel, overlay: PairingOverlay}) => void} call - What to do.
     */
    whenStarted(call) {
        if (this.deck) {
            call(this.deck);
        } else {
            this.pending.push(call);
        }
    }
}
