/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EventEmitter} from "events";
import {PlayerEvents} from "./playerEvents.js";
import {TalkTimerEvents} from "./TalkTimer.js";
import {DisplayCommands} from "./DisplayCommands.js";
import {CameraTracker} from "./CameraTracker.js";
import {cameraMoveMessage} from "../protocol/camera.js";
import {Roles, helloMessage, deckIdOf} from "../protocol/hello.js";
import {
    MessageNames,
    frameChangeMessage,
    blankMessage,
    customMessage,
    followLinkMessage,
    keyMessage,
    readMessage
} from "../protocol/messages.js";
import {fromLegacy, legacyLoadedMessage} from "../protocol/legacy.js";
import {thumbnailMessage} from "../protocol/thumbnails.js";
import {timerMessage} from "../protocol/timer.js";
import {viewportMessage, readViewport} from "../protocol/viewport.js";
import {TransportSet} from "../protocol/TransportSet.js";
import {DRAWING_COMMANDS, EMPTY_DRAWINGS} from "../protocol/drawings.js";
import {applyDrawing} from "../protocol/strokes.js";

/** @typedef {import("../protocol/messages.js").Message} Message */
/** @typedef {import("../protocol/hello.js").FrameInfo} FrameInfo */
/** @typedef {import("../protocol/messages.js").KeyModifiers} KeyModifiers */
/** @typedef {import("../protocol/TransportSet.js").Transport} Transport */
/** @typedef {import("../protocol/camera.js").CameraMove} CameraMove */
/** @typedef {import("../protocol/drawings.js").Drawings} Drawings */

/**
 * What a deck needs to become a presenter preview.
 *
 * @typedef {object} PreviewOptions
 * @property {boolean} isCurrent - Does it show the current frame?
 * @property {(id: string) => void} onFollowLink - Called with the id of each link clicked in it.
 * @property {(key: string, modifiers: KeyModifiers) => void} onKey - Called with each key pressed
 *   in it.
 * @property {(move: CameraMove) => void} onCamera - Called with each pan and zoom made on it.
 * @property {(command: import("../protocol/drawings.js").DrawingCommand) => void} onDrawing -
 *   Called with each stroke command the speaker's pen makes on it.
 * @property {() => Drawings} drawings - The drawings it shows.
 */

/** The current preview's pen: what it draws with comes from the presenter.
 *
 * @typedef {{setTool: (tool: import("../protocol/drawings.js").DrawingTool) => void}} Pen
 */

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
 * @property {import("./TalkTimer.js").TalkTimer} timer - The talk timer.
 * @property {Transport} transport - The first transport to a surface (a `LocalTransport`).
 * @property {any} host - The window the deck plays in.
 * @property {(options: PreviewOptions) => ?Pen} enterPreviewMode - Turns the deck into a
 *   presenter preview that reports its link clicks, its keys, its pans and zooms and, in the
 *   current preview, the strokes of the pen it returns.
 * @property {(index: number, width: number) => Promise<string>} renderThumbnail - Moves the deck
 *   to a frame and draws it, as a JPEG `data:` URL.
 * @property {{render: (drawings: Drawings) => void}} drawingLayer - Paints the drawings on the
 *   deck.
 */

/** A frame of the deck, as the protocol reports it.
 *
 * @param {any} frame - The frame.
 * @returns {FrameInfo} What the protocol carries.
 */
function frameInfoOf({index, frameId, title, notes}) {
    return {index, id: frameId, title, notes};
}

/** What the legacy table needs to resolve an old name.
 *
 * @param {any} presentation - The deck's presentation.
 * @param {any} player - The deck's player.
 * @returns {import("../protocol/legacy.js").LegacyState} The frames and the blank screen.
 */
function legacyStateOf({frames}, player) {
    return {
        frameCount: frames.length,
        blank: player.blankScreenIsVisible,
        frameIds: frames.map(frame => frame.frameId)
    };
}

/** The display side of the presenter protocol (docs/presenter-protocol.md).
 *
 * It says `hello` when it starts and answers each surface's `hello` with a fresh one, then
 * reports frame changes, the window size, the blank screen, the timer and the camera's view as
 * they change; its `CameraTracker` follows the camera. It hands each command to its
 * `DisplayCommands`, and tells them whether the deck is a preview. A preview also answers requests for thumbnails of its frames.
 * It holds the drawings: it applies each drawing command, paints the result and relays the
 * command; a preview takes whole drawings from its presenter instead, and the current preview
 * reports the strokes of the speaker's pen, which takes its tool from `drawingTool`.
 *
 * @extends EventEmitter
 */
export class DisplayChannel extends EventEmitter {
    /** Connect a deck to a transport.
     *
     * @param {DisplayChannelOptions} options - The deck's objects and the transport.
     */
    constructor({
        player,
        controller,
        presentation,
        timer,
        transport,
        host,
        enterPreviewMode,
        renderThumbnail,
        drawingLayer
    }) {
        super();
        this.player = player;
        this.controller = controller;
        this.presentation = presentation;
        this.timer = timer;
        this.drawingLayer = drawingLayer;

        /** The drawings on the deck, which the display holds for the session.
         *
         * @type {Drawings}
         */
        this.drawings = EMPTY_DRAWINGS;

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

        /** The pen of the current preview; null in another deck.
         *
         * @type {?Pen}
         */
        this.pen = null;

        /** What carries out each command a surface sends.
         *
         * @type {DisplayCommands}
         */
        this.commands = new DisplayCommands({
            player,
            controller,
            presentation,
            host,
            isPreview: () => this.previewMode,
            renderThumbnail
        });

        /** Where the camera looks, relative to the current frame; a preview's stays unreported.
         *
         * @type {CameraTracker}
         */
        this.cameraTracker = new CameraTracker({
            controller,
            report: message => this.report(message)
        });

        /** The index of the frame last shown: a return to it is not a move in the talk.
         *
         * @type {number}
         */
        this.frameIndex = player.currentFrame.index;

        this.onFrameChange = () => {
            this.report(frameChangeMessage(frameInfoOf(this.player.currentFrame)));
            this.cameraTracker.reset();
            if (player.currentFrame.index !== this.frameIndex) {
                this.frameIndex = player.currentFrame.index;
                timer.frameChanged();
            }
        };
        this.onBlankScreenChange = () => this.report(blankMessage(player.blankScreenIsVisible));
        this.onResize = () => this.report(viewportMessage(host));
        this.onTimerChange = () => this.report(timerMessage(timer.state));
        player.on(PlayerEvents.frameChange, this.onFrameChange);
        player.on(PlayerEvents.blankScreenChange, this.onBlankScreenChange);
        host.addEventListener("resize", this.onResize);
        timer.on(TalkTimerEvents.change, this.onTimerChange);
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
            [MessageNames.next]: ({transition}) => this.commands.next(transition),
            [MessageNames.previous]: ({transition}) => this.commands.previous(transition),
            [MessageNames.jumpToFrame]: ({index, transition}) =>
                this.commands.jumpToFrame(index, transition),
            [MessageNames.blank]: ({on}) => this.commands.blank(on),
            [MessageNames.preview]: ({current}) => this.preview(current),
            [MessageNames.followLink]: ({id}) => this.commands.followLink(id),
            [MessageNames.thumbnailRequest]: ({index, width}, legacy, from) =>
                this.answerThumbnail(index, width, from),
            [MessageNames.custom]: ({type, data}) =>
                this.emit(DisplayChannelEvents.custom, type, data),
            // The reader lets through only the actions of `TimerActions`, each a method of the timer.
            [MessageNames.timerAction]: ({action}) => timer[action](),
            [MessageNames.timerTarget]: ({targetMs}) => timer.setTarget(targetMs),
            [MessageNames.cameraMove]: move => this.commands.moveCamera(move),
            [MessageNames.cameraReset]: () => this.commands.resetCamera(),
            [MessageNames.camera]: view => this.commands.showView(view),
            [MessageNames.drawingTool]: tool => {
                if (this.pen) {
                    this.pen.setTool(tool);
                }
            },
            [MessageNames.drawings]: ({visible, strokes}) => {
                if (this.previewMode) {
                    this.showDrawings({visible, strokes});
                }
            },
            ...Object.fromEntries(
                DRAWING_COMMANDS.map(name => [name, command => this.draw(command)])
            )
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

    /** The display's `hello`, with its state as it is now.
     *
     * @readonly
     * @type {Message}
     */
    get hello() {
        return helloMessage(Roles.display, {
            deckId: deckIdOf(this.host.location.pathname),
            version: this.host.document.lastModified,
            frameCount: this.presentation.frames.length,
            viewport: readViewport(viewportMessage(this.host)),
            frame: frameInfoOf(this.player.currentFrame),
            frames: this.presentation.frames.map(frameInfoOf),
            blank: this.player.blankScreenIsVisible,
            layouts: this.presentation.presenterLayouts,
            timer: this.timer.state,
            camera: this.cameraTracker.view,
            drawings: this.drawings,
            canvas: this.presentation.document.sourceCanvas()
        });
    }

    /** Carry out a drawing command from a surface: paint the drawings after it and relay it.
     * A command that changes nothing is not relayed.
     *
     * @param {import("../protocol/drawings.js").DrawingCommand} command - The command.
     */
    draw(command) {
        const drawings = applyDrawing(this.drawings, command);
        if (drawings !== this.drawings) {
            this.showDrawings(drawings);
            this.report(command);
        }
    }

    /** Hold and paint new drawings.
     *
     * @param {Drawings} drawings - The drawings.
     */
    showDrawings(drawings) {
        this.drawings = drawings;
        this.drawingLayer.render(drawings);
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
        const message = current || fromLegacy(data, legacyStateOf(this.presentation, this.player));
        if (message && Object.hasOwn(this.handlers, message.name)) {
            this.handlers[message.name](message, !current, from);
        } else {
            console.log(`Unsupported message: ${data && data.name}`);
        }
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
            from.send(frameChangeMessage(frameInfoOf(this.player.currentFrame)));
            from.send(viewportMessage(this.host));
        }
    }

    /** Turn the deck into a presenter preview, once, and keep the current preview's pen.
     *
     * @param {boolean} current - Does it show the current frame?
     */
    preview(current) {
        if (!this.previewMode) {
            this.previewMode = true;
            this.pen = this.enterPreviewMode({
                isCurrent: current,
                onFollowLink: id => this.transport.broadcast(followLinkMessage(id)),
                onKey: (key, modifiers) => this.transport.broadcast(keyMessage(key, modifiers)),
                onCamera: move => this.transport.broadcast(cameraMoveMessage(move)),
                onDrawing: command => this.transport.broadcast(command),
                drawings: () => this.drawings
            });
        }
    }

    /** Answer with a frame the commands draw, in a preview only: nothing may move the audience
     * window's camera to make a thumbnail.
     *
     * @param {number} index - The frame's position, from 0.
     * @param {number} width - The thumbnail's width, in pixels.
     * @param {Transport} from - The transport the request came on, the only one answered.
     */
    async answerThumbnail(index, width, from) {
        if (!this.previewMode) {
            return;
        }
        const url = await this.commands.thumbnail(index, width);
        from.send(thumbnailMessage(index, url));
    }

    /** Remove every listener the channel added, stop its camera tracker, and close its
     * transports.
     */
    dispose() {
        this.player.off(PlayerEvents.frameChange, this.onFrameChange);
        this.player.off(PlayerEvents.blankScreenChange, this.onBlankScreenChange);
        this.host.removeEventListener("resize", this.onResize);
        this.timer.off(TalkTimerEvents.change, this.onTimerChange);
        this.cameraTracker.dispose();
        this.stopReceiving();
        this.transport.dispose();
        this.removeAllListeners();
    }
}
