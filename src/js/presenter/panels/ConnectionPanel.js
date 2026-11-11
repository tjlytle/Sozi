/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {DisplayMirrorEvents} from "../DisplayMirror.js";
import {statusText} from "../statusText.js";

/** @typedef {import("../DisplayMirror.js").DisplayMirror} DisplayMirror */

/** The Connection panel: can the presenter still reach the display? */
export class ConnectionPanel {
    /** Draw the panel and follow the transport's status.
     *
     * @param {HTMLElement} element - The element the panel draws into.
     * @param {DisplayMirror} mirror - What the display last reported, and the status.
     */
    constructor(element, mirror) {
        this.element = element;
        this.mirror = mirror;

        this.text = element.ownerDocument.createElement("p");
        this.text.className = "sozi-connection";
        this.text.setAttribute("role", "status");
        element.append(this.text);

        /** Show each new status.
         *
         * @param {{status?: string}} part - What changed in the mirror.
         */
        this.onChange = ({status}) => {
            if (status) {
                this.show(status);
            }
        };
        mirror.on(DisplayMirrorEvents.change, this.onChange);
        this.show(mirror.status);
    }

    /** Show a status.
     *
     * @param {string} status - One of `TransportStatus`.
     */
    show(status) {
        this.text.textContent = statusText(status);
    }

    /** Stop following the status and empty the element. */
    dispose() {
        this.mirror.off(DisplayMirrorEvents.change, this.onChange);
        this.element.replaceChildren();
    }
}
