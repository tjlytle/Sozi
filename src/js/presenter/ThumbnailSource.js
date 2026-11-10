/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {nextToRender} from "./framePicker.js";
import {
    MessageNames,
    Roles,
    helloMessage,
    previewMessage,
    readMessage
} from "../protocol/messages.js";
import {thumbnailRequestMessage} from "../protocol/thumbnails.js";

/** @typedef {import("./ThumbnailCache.js").ThumbnailCache} ThumbnailCache */
/** @typedef {import("../protocol/LocalTransport.js").LocalTransport} LocalTransport */

/** The width of the deck that renders the thumbnails, in pixels: a deck draws its text for
 * its own size, so a small one would not look like the talk.
 *
 * @readonly
 * @default
 * @type {number}
 */
const DECK_WIDTH = 1024;

/**
 * The deck to show thumbnails of.
 *
 * @typedef {object} ThumbnailDeck
 * @property {string} deckId - The deck.
 * @property {string} version - The date of the page the display plays.
 * @property {number} frameCount - How many frames it has.
 * @property {number} aspect - The display's shape, its width over its height.
 */

/** The render queue of the Frames panel.
 *
 * It reads the cache first. Only if something is missing does it make one off-screen deck, and
 * it sends that deck one request at a time, so that a phone is never swamped. Every surface
 * already loads the deck for its previews, so nothing crosses the link to the display. The
 * iframe goes as soon as nothing is left.
 */
export class ThumbnailSource {
    /** Keep what it works with; it does nothing until `show`.
     *
     * @param {object} options - What it works with.
     * @param {ThumbnailCache} options.cache - Where thumbnails are kept.
     * @param {Document} options.doc - The page the iframe goes in.
     * @param {string} options.src - The deck's page.
     * @param {string} options.pageVersion - The date of the page this runs in. A reload keeps
     *   the audience window, so after a rebuild the display still names its old date.
     * @param {number} options.width - The width of a thumbnail, in pixels.
     * @param {(target: Window) => LocalTransport} options.createTransport - Makes the link to
     *   the iframe's window.
     */
    constructor({cache, doc, src, pageVersion, width, createTransport}) {
        this.cache = cache;
        this.doc = doc;
        this.src = src;
        this.pageVersion = pageVersion;
        this.width = width;
        this.createTransport = createTransport;

        /** The frames still to render, in deck order.
         *
         * @type {number[]}
         */
        this.missing = [];

        /** The frames on screen.
         *
         * @type {number[]}
         */
        this.visible = [];

        /** The frame asked for and not answered yet, null when there is none.
         *
         * @type {?number}
         */
        this.pending = null;

        /** Which `show` is the latest, so that an older one stops when the cache answers.
         *
         * @type {number}
         */
        this.generation = 0;

        /** The deck's iframe, null when there is none.
         *
         * @type {?HTMLIFrameElement}
         */
        this.iframe = null;

        /** The link to the iframe's deck, null until it has loaded.
         *
         * @type {?LocalTransport}
         */
        this.transport = null;

        /** Called with each thumbnail found or rendered.
         *
         * @type {(index: number, url: string) => void}
         */
        this.onThumbnail = () => {};

        this.onDeckLoad = () => this.connect();
    }

    /** Report the thumbnails of a deck, starting again from the cache.
     *
     * @param {ThumbnailDeck} deck - The deck.
     * @param {(index: number, url: string) => void} onThumbnail - Called with each one.
     * @returns {Promise<void>} Settled once the cache has answered.
     */
    async show({deckId, version, frameCount, aspect}, onThumbnail) {
        this.closeDeck();
        this.onThumbnail = onThumbnail;
        const generation = ++this.generation;
        const held = await this.cache.open(deckId, `${version} ${this.pageVersion}`);
        if (generation !== this.generation) {
            return;
        }
        held.forEach((url, index) => onThumbnail(index, url));
        this.missing = Array.from({length: frameCount}, (_, index) => index).filter(
            index => !held.has(index)
        );
        if (this.missing.length) {
            this.openDeck(aspect);
        }
    }

    /** Say which frames are on screen: they are rendered first.
     *
     * @param {number[]} indexes - Their positions.
     */
    setVisible(indexes) {
        this.visible = indexes;
    }

    /** Make the off-screen deck, with the display's shape.
     *
     * @param {number} aspect - The display's width over its height.
     */
    openDeck(aspect) {
        const iframe = this.doc.createElement("iframe");
        iframe.className = "sozi-thumbnail-deck";
        iframe.setAttribute("aria-hidden", "true");
        iframe.setAttribute("tabindex", "-1");
        iframe.style.width = `${DECK_WIDTH}px`;
        iframe.style.height = `${DECK_WIDTH / aspect}px`;
        iframe.addEventListener("load", this.onDeckLoad);
        iframe.src = this.src;
        this.iframe = iframe;
        this.doc.body.append(iframe);
    }

    /** Connect to the deck that has just loaded. */
    connect() {
        this.closeTransport();
        // Cast: a loaded iframe has a window.
        const target = /** @type {Window} */ (/** @type {any} */ (this.iframe).contentWindow);
        const transport = this.createTransport(target);
        this.transport = transport;
        transport.onMessage(data => this.receive(readMessage(data)));
        // A deck that loaded before the transport answers with its hello.
        transport.send(helloMessage(Roles.surface));
    }

    /** Act on a message from the deck.
     *
     * @param {?import("../protocol/messages.js").Message} message - The message, if valid.
     */
    receive(message) {
        if (!message) {
            return;
        }
        if (message.name === MessageNames.hello && message.role === Roles.display) {
            if (this.pending === null) {
                // Cast: `connect` set it before listening.
                /** @type {LocalTransport} */ (this.transport).send(previewMessage(false));
                this.requestNext();
            }
        } else if (message.name === MessageNames.thumbnail && message.index === this.pending) {
            this.take(message.index, message.url);
        }
    }

    /** Take an answer; a failed render leaves its tile empty, and the queue moves on.
     *
     * @param {number} index - The frame's position.
     * @param {string} url - The thumbnail, empty when rendering failed.
     */
    take(index, url) {
        this.missing = this.missing.filter(other => other !== index);
        this.pending = null;
        if (url) {
            this.onThumbnail(index, url);
            // The cache keeps it in memory whatever IndexedDB does, so a failure is no news.
            void this.cache.put(index, url);
        }
        this.requestNext();
    }

    /** Ask for the next frame, or close the deck when nothing is left. */
    requestNext() {
        this.pending = nextToRender(this.missing, this.visible);
        if (this.pending === null) {
            this.closeDeck();
        } else {
            // Cast: only a deck's messages lead here, and they come through its transport.
            /** @type {LocalTransport} */ (this.transport).send(
                thumbnailRequestMessage(this.pending, this.width)
            );
        }
    }

    /** Remove the deck's iframe and close the link to it. */
    closeDeck() {
        if (this.iframe) {
            this.iframe.removeEventListener("load", this.onDeckLoad);
            this.iframe.remove();
            this.iframe = null;
        }
        this.closeTransport();
        this.pending = null;
        this.missing = [];
    }

    /** Close the link to the deck, if there is one. */
    closeTransport() {
        if (this.transport) {
            this.transport.dispose();
            this.transport = null;
        }
    }

    /** Stop rendering, and close the deck and the cache. */
    dispose() {
        this.generation++;
        this.closeDeck();
        this.cache.dispose();
    }
}
