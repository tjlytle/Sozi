/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {linkTarget} from "./noteLinks.js";

/** Own the delegated frame-link clicks and annotate links in the notes. */
export class NoteLinkClicks {
    /** Listen for frame links in the notes body.
     * @param {HTMLElement} body - The notes body.
     * @param {object} options - Injected navigation dependencies.
     * @param {() => import("../protocol/messages.js").FrameInfo[]} options.frames - Last drawn frames.
     * @param {(index: number, transition: boolean) => void} options.jumpToFrame - Move the display.
     */
    constructor(body, {frames, jumpToFrame}) {
        this.body = body;
        this.frames = frames;
        this.jumpToFrame = jumpToFrame;
        /** Move the display for a link to a frame; a `#` link never changes the page's address.
         *
         * @param {MouseEvent} evt - The click.
         */
        this.onClick = evt => {
            const link = /** @type {Element} */ (evt.target).closest("a[href]");
            const href = link ? link.getAttribute("href") || "" : "";
            if (!href.startsWith("#")) {
                return;
            }
            evt.preventDefault();
            const target = linkTarget(href, this.frames());
            if (target.kind === "frame") {
                this.jumpToFrame(target.index, !evt.shiftKey);
            }
        };
        body.addEventListener("click", this.onClick, false);
    }

    /** Mark a link to a missing frame as broken, and open any link off the deck in a new tab.
     *
     * @param {HTMLElement} content - The notes of a section, sanitized.
     */
    mark(content) {
        for (const link of content.querySelectorAll("a[href]")) {
            const target = linkTarget(link.getAttribute("href") || "", this.frames());
            if (target.kind === "broken") {
                link.classList.add("sozi-notes__link--broken");
                link.setAttribute("aria-disabled", "true");
                link.setAttribute("title", `No frame "${target.fragment}" in this deck`);
            } else if (target.kind === "external") {
                link.setAttribute("target", "_blank");
                link.setAttribute("rel", "noopener noreferrer");
            }
        }
    }

    /** Remove the delegated click listener. */
    dispose() {
        this.body.removeEventListener("click", this.onClick, false);
    }
}
