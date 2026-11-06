/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {DisplayMirrorEvents} from "../DisplayMirror.js";
import {messageForKey} from "../keys.js";
import {LocalTransport} from "../../protocol/LocalTransport.js";
import {
    MessageNames,
    Roles,
    blankMessage,
    followLinkMessage,
    helloMessage,
    jumpToFrameMessage,
    previewMessage,
    readMessage
} from "../../protocol/messages.js";

/** @typedef {import("../DisplayMirror.js").DisplayMirror} DisplayMirror */
/** @typedef {import("../../protocol/messages.js").Message} Message */

/**
 * What a preview shows.
 *
 * @typedef {object} PreviewOptions
 * @property {number} offset - The frame it shows, relative to the current one.
 * @property {string} className - The class of its iframe.
 * @property {string} src - The deck's page, empty when there is none to show.
 */

/** A preview panel: the deck in an iframe, kept on a frame relative to the display's.
 *
 * The preview of the current frame forwards the links clicked in it; every preview
 * forwards the presentation keys pressed in it. When the iframe loads again (a panel
 * minimised and restored is put back in the page), the preview connects to it again.
 */
export class PreviewPanel {
    /** Draw the preview and follow the display.
     *
     * @param {HTMLElement} element - The element the panel draws into.
     * @param {DisplayMirror} mirror - What the display last reported.
     * @param {(message: Message) => void} send - Sends a message to the audience window.
     * @param {PreviewOptions} options - What the preview shows.
     */
    constructor(element, mirror, send, {offset, className, src}) {
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
        this.iframe.title = className;
        this.onLoad = () => this.connect();
        this.iframe.addEventListener("load", this.onLoad, false);
        // A hosted shell with no deck to show leaves its previews empty.
        if (src) {
            this.iframe.src = src;
        }
        box.append(this.iframe);
        element.append(box);

        /** Follow the display to a new frame.
         *
         * @param {{index?: number}} part - What changed in the mirror.
         */
        this.onChange = ({index}) => {
            if (index !== undefined) {
                this.update();
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
        } else if (message.name === MessageNames.followLink && this.current) {
            this.send(followLinkMessage(message.id));
        } else if (message.name === MessageNames.key) {
            const command = messageForKey(message.key, message.modifiers, this.mirror);
            if (command) {
                this.send(command);
            }
        }
    }

    /** Move the deck to its frame, or blank it when the deck has no such frame. */
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
    }

    /** Stop following the display, close the transport and empty the element. */
    dispose() {
        this.mirror.off(DisplayMirrorEvents.change, this.onChange);
        this.iframe.removeEventListener("load", this.onLoad, false);
        this.disconnect();
        this.element.replaceChildren();
    }
}
