/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EventEmitter} from "events";
import {DisplayMirrorEvents} from "./DisplayMirror.js";
import {readPanel} from "./panels.js";
import {TransportEvents} from "../protocol/LocalTransport.js";
import {
    Roles,
    blankMessage,
    customMessage,
    helloMessage,
    jumpToFrameMessage,
    nextMessage,
    previousMessage,
    readMessage
} from "../protocol/messages.js";
import {timerActionMessage, timerTargetMessage} from "../protocol/timer.js";

/** @typedef {import("./DisplayMirror.js").DisplayMirror} DisplayMirror */
/** @typedef {import("./Workspace.js").Workspace} Workspace */
/** @typedef {import("./panels.js").PanelDefinition} PanelDefinition */
/** @typedef {import("./shellLink.js").ShellLink} ShellLink */
/** @typedef {import("../protocol/TransportSet.js").TransportSet} TransportSet */
/** @typedef {import("../protocol/TransportSet.js").Transport} Transport */

/** The events `sozi.presenter` emits.
 *
 * `frameChange` carries the frame, `viewport` the display's size, `status` the status of the
 * link to the display, `timer` the timer as the display reported it, and `message` every valid
 * message, once the mirror has taken it.
 *
 * @readonly
 */
export const PresenterEvents = Object.freeze({
    frameChange: "frameChange",
    viewport: "viewport",
    status: "status",
    timer: "timer",
    message: "message"
});

/**
 * Emit the events for what changed in the mirror.
 *
 * @param {EventEmitter} events - Where the events go.
 * @param {{frame?: any, viewport?: any, status?: string, timer?: any}} part - The fields that
 *     changed.
 */
function emitChanges(events, {frame, viewport, status, timer}) {
    if (frame) {
        events.emit(PresenterEvents.frameChange, frame);
    }
    if (viewport) {
        events.emit(PresenterEvents.viewport, viewport);
    }
    if (status) {
        events.emit(PresenterEvents.status, status);
    }
    if (timer) {
        events.emit(PresenterEvents.timer, timer);
    }
}

/** What the page publishes as `window.sozi.presenter`: the API of the presenter console.
 *
 * It exists when the module loads, because custom scripts run before `load`. A call made
 * before `mount` waits there, in the order it came.
 */
export class PresenterApi {
    /** Listen to the transports and the mirror.
     *
     * @param {object} options - The objects it is built on.
     * @param {DisplayMirror} options.mirror - What the display last reported.
     * @param {TransportSet} options.transports - The links to the display.
     */
    constructor({mirror, transports}) {
        this.mirror = mirror;
        this.transports = transports;

        /** Where the events go; a handler sees only `on` and `off`.
         *
         * @type {EventEmitter}
         */
        this.events = new EventEmitter();

        /** The workspace, null until `mount`.
         *
         * @type {?Workspace}
         */
        this.workspace = null;

        /** What was called before `mount`, in order.
         *
         * @type {(() => void)[]}
         */
        this.pending = [];

        /** The ids registered so far: a second panel with one would replace the first.
         *
         * @type {Set<string>}
         */
        this.panelIds = new Set();

        /** The pairing link, once the hosted shell has read one.
         *
         * @type {?ShellLink}
         */
        this.pairingLink = null;

        /** What an add-on's script uses to drive the display.
         *
         * @readonly
         */
        this.display = Object.freeze({
            /** Go to the frame at an index.
             *
             * @param {number} index - Its position, from 0.
             * @param {boolean} [transition] - Animate the move; false jumps straight there.
             */
            jumpToFrame: (index, transition = true) => {
                this.command(jumpToFrameMessage(index, transition));
            },
            /** Go to the next frame. */
            next: () => {
                this.command(nextMessage());
            },
            /** Go to the previous frame. */
            previous: () => {
                this.command(previousMessage());
            },
            /** Show or hide the blank screen.
             *
             * @param {boolean} on - Show it?
             */
            blank: on => {
                this.command(blankMessage(on));
            },
            /** Send a message to the display's add-ons.
             *
             * @param {string} name - The add-on's name for the message.
             * @param {any} payload - Its content.
             */
            send: (name, payload) => {
                this.command(customMessage(name, payload));
            },
            /** Start, pause or reset the talk timer.
             *
             * @param {string} action - `start`, `pause` or `reset`.
             */
            timerAction: action => {
                this.command(timerActionMessage(action));
            },
            /** Set the talk's target length, or clear it.
             *
             * @param {?number} ms - The length in milliseconds, null for none.
             */
            setTimerTarget: ms => {
                this.command(timerTargetMessage(ms));
            }
        });

        // The mirror takes a message first, so that a handler can read it.
        this.stopReceiving = transports.onMessage(data => {
            const message = readMessage(data);
            if (message) {
                mirror.apply(message);
                this.events.emit(PresenterEvents.message, message);
            }
        });
        this.onStatus = status => mirror.setStatus(status);
        transports.on(TransportEvents.statusChange, this.onStatus);
        this.onMirrorChange = part => emitChanges(this.events, part);
        mirror.on(DisplayMirrorEvents.change, this.onMirrorChange);
    }

    /** Add a panel: it docks, tabs, closes and is remembered like a built-in one.
     *
     * @param {PanelDefinition} def - The panel.
     * @throws {TypeError} If it is not valid, or its id is taken.
     */
    registerPanel(def) {
        const spec = readPanel(def);
        if (this.panelIds.has(spec.id)) {
            throw new TypeError(`A panel with the id "${spec.id}" is already registered`);
        }
        this.panelIds.add(spec.id);
        this.whenMounted(workspace => workspace.addPanel(spec));
    }

    /** Add a link to the display and greet it; commands go to it from now on.
     *
     * Before `mount` it waits, so that it comes after the audience window's link.
     *
     * @param {Transport} transport - The transport.
     */
    registerTransport(transport) {
        this.whenMounted(() => {
            this.transports.add(transport);
            transport.send(helloMessage(Roles.surface));
        });
    }

    /** Call a function on an event.
     *
     * @param {string} name - One of `PresenterEvents`.
     * @param {(...args: any[]) => void} handler - The function.
     * @throws {TypeError} If there is no such event.
     */
    on(name, handler) {
        if (!Object.hasOwn(PresenterEvents, name)) {
            throw new TypeError(`The presenter has no event "${name}"`);
        }
        this.events.on(name, handler);
    }

    /** Stop calling a function on an event.
     *
     * @param {string} name - One of `PresenterEvents`.
     * @param {(...args: any[]) => void} handler - The function.
     */
    off(name, handler) {
        this.events.off(name, handler);
    }

    /** What the display last reported, for a panel that registers late.
     *
     * `timer.elapsedMs` is the time counted by now, so an add-on need not add anything to it.
     *
     * @readonly
     * @type {{frame: any, frames: any[], frameCount: number, deckId: string, version: string,
     *   viewport: any, blank: boolean, status: string, timer: any}}
     */
    get state() {
        const {mirror} = this;
        const {frame, frames, frameCount, deckId, version, viewport, blank, status} = mirror;
        const timer = {...mirror.timer, elapsedMs: mirror.elapsedAt()};
        return {frame, frames, frameCount, deckId, version, viewport, blank, status, timer};
    }

    /** The pairing link of the hosted shell, for add-ons; null on the local page.
     *
     * @type {?ShellLink}
     * @throws {TypeError} If it is set twice: it is read-only to add-ons.
     */
    get link() {
        return this.pairingLink;
    }

    set link(link) {
        if (this.pairingLink) {
            throw new TypeError("The presenter's pairing link is already set");
        }
        this.pairingLink = link && Object.freeze({...link, params: Object.freeze(link.params)});
    }

    /** Give the API its workspace, and do what waited for it.
     *
     * @param {Workspace} workspace - The workspace.
     */
    mount(workspace) {
        this.workspace = workspace;
        for (const call of this.pending.splice(0)) {
            call();
        }
    }

    /** Remove every listener it added. */
    dispose() {
        this.stopReceiving();
        this.transports.off(TransportEvents.statusChange, this.onStatus);
        this.mirror.off(DisplayMirrorEvents.change, this.onMirrorChange);
        this.events.removeAllListeners();
    }

    /** Do something now if the workspace is there, or when it comes.
     *
     * @param {(workspace: Workspace) => void} call - What to do.
     */
    whenMounted(call) {
        if (this.workspace) {
            call(this.workspace);
        } else {
            this.pending.push(() => call(/** @type {Workspace} */ (this.workspace)));
        }
    }

    /** Send a command to the primary link, once there is one to send it on.
     *
     * @param {object} message - A message built by `protocol/`.
     */
    command(message) {
        this.whenMounted(() => this.transports.sendToPrimary(message));
    }
}
