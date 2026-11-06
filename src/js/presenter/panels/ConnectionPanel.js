/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {DisplayMirrorEvents} from "../DisplayMirror.js";
import {TransportStatus} from "../../protocol/LocalTransport.js";

/** @typedef {import("../DisplayMirror.js").DisplayMirror} DisplayMirror */

/** What the panel says for each status of the transport to the audience window.
 *
 * @readonly
 */
const STATUS_TEXT = Object.freeze({
    [TransportStatus.connected]: "Connected",
    [TransportStatus.closed]: "Closed"
});

/** The Connection panel: can the presenter still reach the audience window? */
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
        this.text.textContent = Object.hasOwn(STATUS_TEXT, status) ? STATUS_TEXT[status] : status;
    }

    /** Stop following the status and empty the element. */
    dispose() {
        this.mirror.off(DisplayMirrorEvents.change, this.onChange);
        this.element.replaceChildren();
    }
}
