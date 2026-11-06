/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {DisplayMirrorEvents} from "../DisplayMirror.js";
import {blankMessage, nextMessage, previousMessage} from "../../protocol/messages.js";

/** @typedef {import("../DisplayMirror.js").DisplayMirror} DisplayMirror */
/** @typedef {import("../../protocol/messages.js").Message} Message */

/** The Controls panel: previous, the frame counter, next, and the blank screen. */
export class ControlsPanel {
    /** Draw the panel and follow the display.
     *
     * @param {HTMLElement} element - The element the panel draws into.
     * @param {DisplayMirror} mirror - What the display last reported.
     * @param {(message: Message) => void} send - Sends a message to the audience window.
     */
    constructor(element, mirror, send) {
        this.element = element;
        this.mirror = mirror;

        const doc = element.ownerDocument;
        const controls = doc.createElement("div");
        controls.className = "sozi-controls";

        /** A button of the panel.
         *
         * @param {string} label - Its text.
         * @param {string} title - Its accessible name.
         * @param {() => Message} message - What it sends when pressed.
         * @returns {HTMLButtonElement} The button.
         */
        const button = (label, title, message) => {
            const b = doc.createElement("button");
            b.type = "button";
            b.textContent = label;
            b.title = title;
            b.setAttribute("aria-label", title);
            b.addEventListener("click", () => send(message()), false);
            return b;
        };
        const previous = button("«", "Previous", () => previousMessage());
        previous.id = "sozi-previous-btn";
        const next = button("»", "Next", () => nextMessage());
        next.id = "sozi-next-btn";
        this.blankButton = button("Blank", "Blank", () => blankMessage(!mirror.blank));

        const counter = doc.createElement("span");
        counter.className = "sozi-counter";
        this.index = doc.createElement("span");
        this.index.className = "sozi-current-index";
        this.length = doc.createElement("span");
        this.length.className = "sozi-presentation-length";
        counter.append(this.index, "/", this.length);

        controls.append(previous, counter, next, this.blankButton);
        element.append(controls);

        this.onChange = () => this.show();
        mirror.on(DisplayMirrorEvents.change, this.onChange);
        this.show();
    }

    /** Show the counter and the blank button's state, once the display has said hello. */
    show() {
        if (this.mirror.frame) {
            this.index.textContent = String(this.mirror.index + 1);
            this.length.textContent = String(this.mirror.frameCount);
        }
        this.blankButton.setAttribute("aria-pressed", String(this.mirror.blank));
    }

    /** Stop following the display and empty the element. */
    dispose() {
        this.mirror.off(DisplayMirrorEvents.change, this.onChange);
        this.element.replaceChildren();
    }
}
