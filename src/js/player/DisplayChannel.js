/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EventEmitter} from "events";
import {PlayerEvents} from "./playerEvents.js";
import {PlayerControllerEvents} from "./PlayerController.js";
import {TalkTimerEvents} from "./TalkTimer.js";
import {ON_FRAME, cameraMessage, cameraMoveMessage, composeView} from "../protocol/camera.js";
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
import {thumbnailMessage} from "../protocol/thumbnails.js";
import {timerMessage} from "../protocol/timer.js";
import {viewportMessage, readViewport} from "../protocol/viewport.js";
import {TransportSet} from "../protocol/TransportSet.js";

/** @typedef {import("../protocol/messages.js").Message} Message */
/** @typedef {import("../protocol/messages.js").FrameInfo} FrameInfo */
/** @typedef {import("../protocol/messages.js").KeyModifiers} KeyModifiers */
/** @typedef {import("../protocol/TransportSet.js").Transport} Transport */
/** @typedef {import("../protocol/camera.js").CameraView} CameraView */
/** @typedef {import("../protocol/camera.js").CameraMove} CameraMove */

/**
 * What a deck needs to become a presenter preview.
 *
 * @typedef {object} PreviewOptions
 * @property {boolean} isCurrent - Does it show the current frame?
 * @property {(id: string) => void} onFollowLink - Called with the id of each link clicked in it.
 * @property {(key: string, modifiers: KeyModifiers) => void} onKey - Called with each key pressed
 *   in it.
 * @property {(move: CameraMove) => void} onCamera - Called with each pan and zoom made on it.
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
 * @property {(options: PreviewOptions) => void} enterPreviewMode - Turns the deck into a
 *   presenter preview that reports its link clicks, its keys and its pans and zooms.
 * @property {(index: number, width: number) => Promise<string>} renderThumbnail - Moves the deck
 *   to a frame and draws it, as a JPEG `data:` URL.
 */

/** A frame of the deck, as the protocol reports it.
 *
 * @param {any} frame - The frame.
 * @returns {FrameInfo} What the protocol carries.
 */
function frameInfoOf({index, frameId, title, notes}) {
    return {index, id: frameId, title, notes};
}

/** The display side of the presenter protocol (docs/presenter-protocol.md).
 *
 * It says `hello` when it starts and answers each surface's `hello` with a fresh one, then
 * reports frame changes, the window size, the blank screen, the timer and the camera's view as
 * they change. It hands each command to the controller, or to the player once the deck is a
 * preview. A preview also draws its frames as thumbnails, on request, and shows the view it is
 * sent.
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
        renderThumbnail
    }) {
        super();
        this.player = player;
        this.controller = controller;
        this.presentation = presentation;
        this.timer = timer;

        /** The links to the surfaces: a report goes out on all of them.
         *
         * @type {TransportSet}
         */
        this.transport = new TransportSet();
        this.transport.add(transport);
        this.host = host;
        this.enterPreviewMode = enterPreviewMode;
        this.renderThumbnail = renderThumbnail;

        /** Is the deck a preview in a presenter? A preview reports nothing about itself.
         *
         * @type {boolean}
         */
        this.previewMode = false;

        /** Where the camera looks, relative to the current frame.
         *
         * @type {CameraView}
         */
        this.camera = ON_FRAME;

        /** The index of the frame last shown: a return to it is not a move in the talk.
         *
         * @type {number}
         */
        this.frameIndex = player.currentFrame.index;

        this.onFrameChange = () => {
            this.report(frameChangeMessage(this.frameInfo));
            this.setCamera(ON_FRAME);
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
        this.followCamera();
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
            [MessageNames.thumbnailRequest]: ({index, width}, legacy, from) =>
                this.answerThumbnail(index, width, from),
            [MessageNames.custom]: ({type, data}) =>
                this.emit(DisplayChannelEvents.custom, type, data),
            // The reader lets through only the actions of `TimerActions`, each a method of the timer.
            [MessageNames.timerAction]: ({action}) => timer[action](),
            [MessageNames.timerTarget]: ({targetMs}) => timer.setTarget(targetMs),
            [MessageNames.cameraMove]: move => this.moveCamera(move),
            [MessageNames.cameraReset]: () => player.moveToFrame(player.currentFrame),
            [MessageNames.camera]: view => this.showView(view)
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
        return frameInfoOf(this.player.currentFrame);
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
            frame: this.frameInfo,
            frames: this.presentation.frames.map(frameInfoOf),
            blank: this.player.blankScreenIsVisible,
            layouts: this.presentation.presenterLayouts,
            timer: this.timer.state,
            camera: this.camera
        });
    }

    /** Fold every zoom, pan and rotation of the controller into the view and report it: the
     * moves a surface asks for and those of the display's own mouse go the same way.
     */
    followCamera() {
        const {viewport} = this.controller;
        this.onZoom = ({factor, x, y}) =>
            this.setCamera(
                composeView(this.camera, {
                    x: 0,
                    y: 0,
                    zoom: factor,
                    atX: x / viewport.width,
                    atY: y / viewport.height
                })
            );
        this.onTranslate = ({deltaX, deltaY}) =>
            this.setCamera(
                composeView(this.camera, {
                    x: deltaX / viewport.width,
                    y: deltaY / viewport.height,
                    zoom: 1,
                    atX: 0,
                    atY: 0
                })
            );
        // A preview does not draw a rotation, but the camera has left its frame all the same.
        this.onRotate = () => this.setCamera({...this.camera, offFrame: true});
        this.controller.on(PlayerControllerEvents.zoom, this.onZoom);
        this.controller.on(PlayerControllerEvents.translate, this.onTranslate);
        this.controller.on(PlayerControllerEvents.rotate, this.onRotate);
    }

    /** Take a new view, and report it when it is not the one there was.
     *
     * @param {CameraView} view - The view.
     */
    setCamera(view) {
        const was = this.camera;
        this.camera = view;
        const same = ["offFrame", "zoom", "x", "y"].every(key => view[key] === was[key]);
        if (!same) {
            this.report(cameraMessage(view));
        }
    }

    /** Move the display's camera, in its own pixels; the controller's events report the view.
     *
     * @param {CameraMove} move - The move, in viewport units.
     */
    moveCamera({x, y, zoom, atX, atY}) {
        const {width, height} = this.controller.viewport;
        if (zoom !== 1) {
            this.controller.zoom(zoom, atX * width, atY * height);
        }
        if (x !== 0 || y !== 0) {
            this.controller.translate(x * width, y * height);
        }
    }

    /** Show a view of the current frame, in a preview only: the deck goes back to its frame,
     * then zooms about its top-left corner and pans.
     *
     * @param {CameraView} view - The view.
     */
    showView({zoom, x, y}) {
        if (!this.previewMode) {
            return;
        }
        const {viewport} = this.controller;
        this.player.jumpToFrame(this.player.currentFrame);
        viewport.zoom(zoom, 0, 0);
        viewport.translate(x * viewport.width, y * viewport.height);
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
            this.enterPreviewMode({
                isCurrent: current,
                onFollowLink: id => this.transport.broadcast(followLinkMessage(id)),
                onKey: (key, modifiers) => this.transport.broadcast(keyMessage(key, modifiers)),
                onCamera: move => this.transport.broadcast(cameraMoveMessage(move))
            });
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

    /** Draw a frame and answer with it, in a preview only: nothing may move the audience
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
        let url = "";
        try {
            url = await this.renderThumbnail(index, width);
        } catch (err) {
            // The empty URL tells the surface; the tile keeps its number and title.
            console.warn(`No thumbnail for frame ${index}: ${err}`);
        }
        from.send(thumbnailMessage(index, url));
    }

    /** Remove every listener the channel added, and close its transports. */
    dispose() {
        this.player.off(PlayerEvents.frameChange, this.onFrameChange);
        this.player.off(PlayerEvents.blankScreenChange, this.onBlankScreenChange);
        this.host.removeEventListener("resize", this.onResize);
        this.timer.off(TalkTimerEvents.change, this.onTimerChange);
        this.controller.off(PlayerControllerEvents.zoom, this.onZoom);
        this.controller.off(PlayerControllerEvents.translate, this.onTranslate);
        this.controller.off(PlayerControllerEvents.rotate, this.onRotate);
        this.stopReceiving();
        this.transport.dispose();
        this.removeAllListeners();
    }
}
