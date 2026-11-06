/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EventEmitter} from "events";
import {PlayerEvents} from "./playerEvents.js";
import {
    MessageNames,
    Roles,
    helloMessage,
    frameChangeMessage,
    blankMessage,
    customMessage,
    followLinkMessage,
    keyMessage,
    readMessage,
    deckIdOf
} from "../protocol/messages.js";
import {fromLegacy, legacyLoadedMessage} from "../protocol/legacy.js";
import {viewportMessage, readViewport} from "../protocol/viewport.js";
import {TransportSet} from "../protocol/TransportSet.js";

/** @typedef {import("../protocol/messages.js").Message} Message */
/** @typedef {import("../protocol/messages.js").FrameInfo} FrameInfo */
/** @typedef {import("../protocol/messages.js").KeyModifiers} KeyModifiers */
/** @typedef {import("../protocol/TransportSet.js").Transport} Transport */

/** The events a display channel emits.
 *
 * `custom` carries the `type` and `data` of a `custom` message from a surface.
 *
 * @readonly
 */
export const DisplayChannelEvents = Object.freeze({custom: "custom"});

/**
 * What a display channel is built from.
 *
 * @typedef {object} DisplayChannelOptions
 * @property {any} player - The deck's player.
 * @property {any} controller - The deck's player controller.
 * @property {any} presentation - The deck's presentation.
 * @property {Transport} transport - The first transport to a surface (a `LocalTransport`).
 * @property {any} host - The window the deck plays in.
 * @property {(isCurrent: boolean, onFollowLink: (id: string) => void,
 *   onKey: (key: string, modifiers: KeyModifiers) => void) => void} enterPreviewMode -
 *   Turns the deck into a presenter preview that reports its link clicks and its keys.
 */

/** The display side of the presenter protocol (docs/presenter-protocol.md).
 *
 * It says `hello` when it starts and answers each surface's `hello` with a fresh one, then
 * reports frame changes, the window size and the blank screen as they change. It hands each
 * command to the controller, or to the player once the deck is a preview.
 *
 * @extends EventEmitter
 */
export class DisplayChannel extends EventEmitter {
    /** Connect a deck to a transport.
     *
     * @param {DisplayChannelOptions} options - The deck's objects and the transport.
     */
    constructor({player, controller, presentation, transport, host, enterPreviewMode}) {
        super();
        this.player = player;
        this.controller = controller;
        this.presentation = presentation;

        /** The links to the surfaces: a report goes out on all of them.
         *
         * @type {TransportSet}
         */
        this.transport = new TransportSet();
        this.transport.add(transport);
        this.host = host;
        this.enterPreviewMode = enterPreviewMode;

        /** Is the deck a preview in a presenter? A preview reports nothing about itself.
         *
         * @type {boolean}
         */
        this.previewMode = false;

        this.onFrameChange = () => this.report(frameChangeMessage(this.frameInfo));
        this.onBlankScreenChange = () => this.report(blankMessage(player.blankScreenIsVisible));
        this.onResize = () => this.report(viewportMessage(host));
        player.on(PlayerEvents.frameChange, this.onFrameChange);
        player.on(PlayerEvents.blankScreenChange, this.onBlankScreenChange);
        host.addEventListener("resize", this.onResize);
        this.stopReceiving = this.transport.onMessage((data, from) => this.receive(data, from));

        /** What each message from a surface does, by name: the explicit table (2.5).
         *
         * `legacy` is true when the message was mapped from an old name; `from` is the
         * transport it came on.
         *
         * @type {Readonly<Record<string, (message: any, legacy: boolean, from: Transport) => void>>}
         */
        this.handlers = Object.freeze({
            [MessageNames.hello]: (message, legacy, from) => {
                if (message.role === Roles.surface) {
                    this.answerHello(legacy, from);
                }
            },
            [MessageNames.next]: ({transition}) => this.next(transition),
            [MessageNames.previous]: ({transition}) => this.previous(transition),
            [MessageNames.jumpToFrame]: ({index, transition}) =>
                this.jumpToFrame(index, transition),
            [MessageNames.blank]: ({on}) => this.blank(on),
            [MessageNames.preview]: ({current}) => this.preview(current),
            [MessageNames.followLink]: ({id}) => this.followLink(id),
            [MessageNames.custom]: ({type, data}) =>
                this.emit(DisplayChannelEvents.custom, type, data)
        });
    }

    /** Say `hello`, and send the old `loaded` announcement for one release. */
    start() {
        this.transport.broadcast(this.hello);
        this.transport.broadcast(legacyLoadedMessage(this.presentation.frames.length));
    }

    /** Add a link to a surface, and say `hello` on it alone.
     *
     * @param {Transport} transport - The transport.
     */
    addTransport(transport) {
        this.transport.add(transport);
        transport.send(this.hello);
    }

    /** The current frame, as the protocol reports it.
     *
     * @readonly
     * @type {FrameInfo}
     */
    get frameInfo() {
        const {index, frameId, title, notes} = this.player.currentFrame;
        return {index, id: frameId, title, notes};
    }

    /** The display's `hello`, with its state as it is now.
     *
     * @readonly
     * @type {Message}
     */
    get hello() {
        return helloMessage(Roles.display, {
            deckId: deckIdOf(this.host.location.pathname),
            frameCount: this.presentation.frames.length,
            viewport: readViewport(viewportMessage(this.host)),
            frame: this.frameInfo,
            blank: this.player.blankScreenIsVisible,
            layouts: this.presentation.presenterLayouts
        });
    }

    /** Send a message about the display, unless the deck is a preview.
     *
     * @param {Message} message - The message.
     */
    report(message) {
        if (!this.previewMode) {
            this.transport.broadcast(message);
        }
    }

    /** Send a `custom` message to every surface.
     *
     * @param {string} type - The add-on's name for the message.
     * @param {any} data - Its content.
     */
    sendCustom(type, data) {
        this.transport.broadcast(customMessage(type, data));
    }

    /** Act on the data of a received message; an old name goes through the legacy table.
     *
     * @param {any} data - The data of a message event.
     * @param {Transport} from - The transport it came on.
     */
    receive(data, from) {
        const current = readMessage(data);
        const message = current || fromLegacy(data, this.legacyState);
        if (message && Object.hasOwn(this.handlers, message.name)) {
            this.handlers[message.name](message, !current, from);
        } else {
            console.log(`Unsupported message: ${data && data.name}`);
        }
    }

    /** What the legacy table needs to resolve an old name.
     *
     * @readonly
     * @type {import("../protocol/legacy.js").LegacyState}
     */
    get legacyState() {
        const frames = this.presentation.frames;
        return {
            frameCount: frames.length,
            blank: this.player.blankScreenIsVisible,
            frameIds: frames.map(frame => frame.frameId)
        };
    }

    /** Answer a surface's `hello` with the display's own.
     *
     * An old presenter (`notifyOnFrameChange`) ignores `hello` and waits for the frame and
     * the window size, so it gets both as well, for one release.
     *
     * @param {boolean} legacy - Did the hello come from an old name?
     * @param {Transport} from - The transport it came on, the only one answered.
     */
    answerHello(legacy, from) {
        from.send(this.hello);
        if (legacy) {
            from.send(frameChangeMessage(this.frameInfo));
            from.send(viewportMessage(this.host));
        }
    }

    /** Go to the next frame.
     *
     * @param {boolean} transition - Animate the move.
     */
    next(transition) {
        if (this.previewMode) {
            this.movePlayer(this.player.nextFrame, transition);
        } else if (transition) {
            this.controller.moveToNext();
        } else {
            this.controller.jumpToNext();
        }
    }

    /** Go to the previous frame.
     *
     * @param {boolean} transition - Animate the move.
     */
    previous(transition) {
        if (this.previewMode) {
            this.movePlayer(this.player.previousFrame, transition);
        } else if (transition) {
            this.controller.moveToPrevious();
        } else {
            this.controller.jumpToPrevious();
        }
    }

    /** Go to the frame at an index.
     *
     * @param {number} index - The frame's position, from 0.
     * @param {boolean} transition - Animate the move.
     */
    jumpToFrame(index, transition) {
        if (this.previewMode) {
            this.movePlayer(index, transition);
        } else if (transition) {
            this.controller.moveToFrame(index);
        } else {
            this.controller.jumpToFrame(index);
        }
    }

    /** Move the player itself, as a preview does.
     *
     * @param {any} frame - The frame, or its index.
     * @param {boolean} transition - Animate the move.
     */
    movePlayer(frame, transition) {
        if (transition) {
            this.player.moveToFrame(frame);
        } else {
            this.player.jumpToFrame(frame);
        }
    }

    /** Show or hide the blank screen.
     *
     * @param {boolean} on - Show it?
     */
    blank(on) {
        if (this.previewMode) {
            if (on) {
                this.player.enableBlankScreen();
            } else {
                this.player.disableBlankScreen();
            }
        } else if (on !== this.player.blankScreenIsVisible) {
            this.controller.toggleBlankScreen();
        }
    }

    /** Turn the deck into a presenter preview, once.
     *
     * @param {boolean} current - Does it show the current frame?
     */
    preview(current) {
        if (!this.previewMode) {
            this.previewMode = true;
            this.enterPreviewMode(
                current,
                id => this.transport.broadcast(followLinkMessage(id)),
                (key, modifiers) => this.transport.broadcast(keyMessage(key, modifiers))
            );
        }
    }

    /** Follow a link of the deck, as if it was clicked.
     *
     * @param {string} id - The id of the link element.
     */
    followLink(id) {
        const link = this.presentation.document.root.getElementById(id);
        // SVG <a> elements have no click method, so the click is dispatched.
        if (link) {
            link.dispatchEvent(new this.host.MouseEvent("click"));
        }
    }

    /** Remove every listener the channel added, and close its transports. */
    dispose() {
        this.player.off(PlayerEvents.frameChange, this.onFrameChange);
        this.player.off(PlayerEvents.blankScreenChange, this.onBlankScreenChange);
        this.host.removeEventListener("resize", this.onResize);
        this.stopReceiving();
        this.transport.dispose();
        this.removeAllListeners();
    }
}
