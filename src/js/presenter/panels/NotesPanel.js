/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {setSanitizedHTML} from "../../html/sanitize";
import {DisplayMirrorEvents} from "../DisplayMirror.js";

/** @typedef {import("../DisplayMirror.js").DisplayMirror} DisplayMirror */
/** @typedef {import("../../protocol/messages.js").FrameInfo} FrameInfo */

/** The Notes panel: the current frame's title and the presenter's notes for it. */
export class NotesPanel {
    /** Draw the panel and follow the display.
     *
     * @param {HTMLElement} element - The element the panel draws into.
     * @param {DisplayMirror} mirror - What the display last reported.
     */
    constructor(element, mirror) {
        this.element = element;
        this.mirror = mirror;

        const doc = element.ownerDocument;
        const notes = doc.createElement("div");
        notes.className = "sozi-notes";
        this.title = doc.createElement("h1");
        this.title.className = "sozi-notes-title";
        this.body = doc.createElement("div");
        this.body.className = "sozi-notes-body";
        notes.append(this.title, this.body);
        element.append(notes);

        /** Show each new frame.
         *
         * @param {{frame?: FrameInfo}} part - What changed in the mirror.
         */
        this.onChange = ({frame}) => {
            if (frame) {
                this.show(frame);
            }
        };
        mirror.on(DisplayMirrorEvents.change, this.onChange);
        if (mirror.frame) {
            this.show(mirror.frame);
        }
    }

    /** Show a frame's title and notes.
     *
     * @param {FrameInfo} frame - The frame.
     */
    show(frame) {
        this.title.textContent = frame.title;
        setSanitizedHTML(this.body, frame.notes);
    }

    /** Stop following the display and empty the element. */
    dispose() {
        this.mirror.off(DisplayMirrorEvents.change, this.onChange);
        this.element.replaceChildren();
    }
}
