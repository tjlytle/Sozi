/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {overlayNotes} from "../notes/notesDocument.js";
import {notesUrl} from "./notesPosition.js";

/** @typedef {import("../protocol/messages.js").FrameInfo} FrameInfo */

/** Load the notes published beside a deck and overlay them until disposed. */
export class PublishedNotes {
    /** Receive the page's fetch and the callbacks needed to load notes.
     * @param {object} options - Injected dependencies.
     * @param {(url: string) => Promise<Pick<Response, "ok" | "text">>} options.fetch - Bound fetch.
     * @param {() => string} options.deckHref - The current deck address.
     * @param {() => void} options.onLoad - Called after the notes arrive.
     */
    constructor({fetch, deckHref, onLoad}) {
        this.fetch = fetch;
        this.deckHref = deckHref;
        this.onLoad = onLoad;
        /** @type {?string} */
        this.text = null;
        this.started = false;
        this.disposed = false;
    }

    /** Fetch at most once; an unavailable file leaves the deck's notes in place. */
    async load() {
        if (this.started || this.disposed) {
            return;
        }
        this.started = true;
        const url = notesUrl(this.deckHref());
        if (url === null) {
            return;
        }
        let text;
        try {
            const response = await this.fetch(url);
            text = response.ok ? await response.text() : null;
        } catch {
            // Missing files and refused cross-origin requests keep the deck's own notes.
            return;
        }
        if (text !== null && !this.disposed) {
            this.text = text;
            this.onLoad();
        }
    }

    /** Overlay published notes on the reported frames, preserving the original without a file.
     * @param {FrameInfo[]} frames - The reported frames.
     * @returns {FrameInfo[]} The frames with the published notes, when available.
     */
    overlay(frames) {
        if (this.text === null) {
            return frames;
        }
        return overlayNotes(
            frames.map(frame => ({...frame, frameId: frame.id})),
            this.text
        ).frames;
    }

    /** Ignore any response that arrives after disposal. */
    dispose() {
        this.disposed = true;
    }
}
