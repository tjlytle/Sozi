/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {DisplayMirrorEvents} from "../DisplayMirror.js";
import {messageForKey} from "../keys.js";
import {LocalTransport} from "../../protocol/LocalTransport.js";
import {Roles, helloMessage} from "../../protocol/hello.js";
import {
    MessageNames,
    blankMessage,
    followLinkMessage,
    jumpToFrameMessage,
    previewMessage,
    readMessage
} from "../../protocol/messages.js";
import {cameraMessage, cameraMoveMessage, cameraResetMessage} from "../../protocol/camera.js";
import {DRAWING_COMMANDS, drawingToolMessage, drawingsMessage} from "../../protocol/drawings.js";
import {DrawingToolbar} from "../DrawingToolbar.js";

/** @typedef {import("../DisplayMirror.js").DisplayMirror} DisplayMirror */
/** @typedef {import("../panels.js").PanelHandle} PanelHandle */
/** @typedef {import("../../protocol/messages.js").Message} Message */

/**
 * What a preview shows.
 *
 * @typedef {object} PreviewOptions
 * @property {number} offset - The frame it shows, relative to the current one.
 * @property {string} className - The class of its iframe.
 * @property {string} title - Its panel's title, the iframe's accessible name.
 * @property {string} src - The deck's page, empty when there is none to show.
 * @property {PanelHandle} [panel] - The panel's handle, for the current preview's Maximise.
 */

/** A preview panel: the deck in an iframe, kept on a frame relative to the display's.
 *
 * The preview of the current frame forwards the links clicked in it and the pans and zooms
 * made on it, shows the display's view, and has a Back to frame button while the display's
 * camera is off its frame. It also has the drawing toolbar, tells its deck's pen what the
 * toolbar chose, and forwards the pen's strokes. Every preview forwards the presentation keys
 * pressed in it and shows the display's drawings.
 *
 * Workspace.addPanel constructs one instance per preview, once per page, through spec.render.
 * Closing the panel from its ⋯ menu removes its element from the dock without disposing it.
 * Adding it back from the + menu reuses the same element, so its iframe loads again, as it
 * does when its group is popped out into a window and docked back. On every load the same
 * instance runs connect(), dropping the old transport and saying hello to the new deck.
 * Dragging a panel never reloads its iframe (renderer: "always"; see Workspace).
 */
export class PreviewPanel {
    /** Draw the preview and follow the display.
     *
     * @param {HTMLElement} element - The element the panel draws into.
     * @param {DisplayMirror} mirror - What the display last reported.
     * @param {(message: Message) => void} send - Sends a message to the audience window.
     * @param {PreviewOptions} options - What the preview shows.
     */
    constructor(element, mirror, send, {offset, className, title, src, panel}) {
        this.element = element;
        this.mirror = mirror;
        this.send = send;
        this.offset = offset;

        /** The transport to the iframe's deck, null until it has loaded.
         *
         * @type {?LocalTransport}
         */
        this.transport = null;

        /** Has the deck said hello, so that it takes frames?
         *
         * @type {boolean}
         */
        this.ready = false;

        const doc = element.ownerDocument;
        const box = doc.createElement("div");
        box.className = "sozi-preview-box";
        this.iframe = doc.createElement("iframe");
        this.iframe.className = className;
        this.iframe.title = title;
        this.onLoad = () => this.connect();
        this.iframe.addEventListener("load", this.onLoad, false);
        // A hosted shell with no deck to show leaves its previews empty.
        if (src) {
            this.iframe.src = src;
        }
        box.append(this.iframe);

        /** The Back to frame button of the current preview, null in another.
         *
         * @type {?HTMLButtonElement}
         */
        this.backButton = null;
        if (this.current) {
            this.backButton = doc.createElement("button");
            this.backButton.type = "button";
            this.backButton.className = "sozi-preview-box__back";
            this.backButton.textContent = "Back to frame";
            this.backButton.hidden = !mirror.camera.offFrame;
            this.backButton.addEventListener("click", () => send(cameraResetMessage()));
            box.append(this.backButton);
        }

        /** The drawing toolbar of the current preview, null in another.
         *
         * @type {?DrawingToolbar}
         */
        this.toolbar = this.current
            ? new DrawingToolbar(doc, {
                  mirror,
                  send,
                  panel: panel || null,
                  onTool: () => this.showTool()
              })
            : null;
        if (this.toolbar) {
            element.append(this.toolbar.element);
        }
        element.append(box);

        /** Follow the display to a new frame, the current preview to a new view, and every
         * preview to new drawings.
         *
         * @param {{index?: number, camera?: object, drawings?: object}} part - What changed in
         *   the mirror.
         */
        this.onChange = ({index, camera, drawings}) => {
            if (index !== undefined) {
                this.update();
            } else if (camera !== undefined) {
                this.showCamera();
            }
            if (camera !== undefined && this.backButton) {
                this.backButton.hidden = !mirror.camera.offFrame;
            }
            if (drawings !== undefined) {
                this.showDrawings();
            }
        };
        mirror.on(DisplayMirrorEvents.change, this.onChange);
    }

    /** Does this preview show the current frame?
     *
     * @readonly
     * @type {boolean}
     */
    get current() {
        return this.offset === 0;
    }

    /** Connect to the deck that has just loaded in the iframe. */
    connect() {
        this.disconnect();
        const host = /** @type {Window} */ (this.element.ownerDocument.defaultView);
        // Cast: a loaded iframe has a window.
        const deck = /** @type {Window} */ (this.iframe.contentWindow);
        const transport = new LocalTransport(host, deck);
        transport.onMessage(data => {
            const message = readMessage(data);
            if (message) {
                this.receive(message, transport);
            }
        });
        this.transport = transport;
        // A deck that loaded before the transport answers with its hello.
        transport.send(helloMessage(Roles.surface));
    }

    /** Close the transport to the deck, if there is one. */
    disconnect() {
        if (this.transport) {
            this.transport.dispose();
            this.transport = null;
        }
        this.ready = false;
    }

    /** Act on a message from the deck.
     *
     * @param {Message} message - The message.
     * @param {LocalTransport} transport - The transport it came by.
     */
    receive(message, transport) {
        if (message.name === MessageNames.hello && message.role === Roles.display) {
            // A preview is a display too: it becomes a preview once it says hello.
            this.ready = true;
            transport.send(previewMessage(this.current));
            this.update();
            this.showDrawings();
            this.showTool();
        } else if (DRAWING_COMMANDS.includes(message.name) && this.current) {
            // The pen's strokes: the display draws them and relays them back to the preview.
            this.send(message);
        } else if (message.name === MessageNames.followLink && this.current) {
            this.send(followLinkMessage(message.id));
        } else if (message.name === MessageNames.cameraMove && this.current) {
            this.send(cameraMoveMessage(message));
        } else if (message.name === MessageNames.key) {
            const command = messageForKey(message.key, message.modifiers, this.mirror);
            if (command) {
                this.send(command);
            }
        }
    }

    /** Move the deck to its frame, or blank it when the deck has no such frame. The current
     * preview then shows the display's view, when it is off the frame.
     */
    update() {
        if (!this.ready || !this.transport) {
            return;
        }
        const index = this.mirror.index + this.offset;
        this.transport.send(
            index >= 0 && index < this.mirror.frameCount
                ? jumpToFrameMessage(index, false)
                : blankMessage(true)
        );
        if (this.mirror.camera.offFrame) {
            this.showCamera();
        }
    }

    /** Show the display's view on the current preview's deck. */
    showCamera() {
        if (this.current && this.ready && this.transport) {
            this.transport.send(cameraMessage(this.mirror.camera));
        }
    }

    /** Show the display's drawings on the preview's deck. */
    showDrawings() {
        if (this.ready && this.transport) {
            this.transport.send(drawingsMessage(this.mirror.drawings));
        }
    }

    /** Tell the current preview's deck what its pen draws with. */
    showTool() {
        if (this.toolbar && this.ready && this.transport) {
            this.transport.send(drawingToolMessage(this.toolbar.state));
        }
    }

    /** Stop following the display, close the transport and empty the element. */
    dispose() {
        this.mirror.off(DisplayMirrorEvents.change, this.onChange);
        if (this.toolbar) {
            this.toolbar.dispose();
        }
        this.iframe.removeEventListener("load", this.onLoad, false);
        this.disconnect();
        this.element.replaceChildren();
    }
}
