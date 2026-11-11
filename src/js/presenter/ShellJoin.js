/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {PresenterEvents} from "./PresenterApi.js";
import {readShellLink} from "./shellLink.js";
import {statusText} from "./statusText.js";
import {TransportStatus} from "../protocol/LocalTransport.js";

/** @typedef {import("./PresenterApi.js").PresenterApi} PresenterApi */
/** @typedef {import("./shellLink.js").ShellLink} ShellLink */

/** What the notice says when the shell has no talk to follow.
 *
 * @readonly
 */
const NOTICE = Object.freeze({
    notConnected: "Not connected",
    noLink: "Not connected. Open a pairing link to join a talk.",
    refused: "This is not a Sozi pairing link."
});

/** The hosted shell's part of the page: it joins the talk its pairing link names.
 *
 * It says "Not connected" from the start, because a transport only reports a change, and an
 * add-on registers one only after the link has been read. From then on the notice names each
 * status in the Connection panel's words, and hides while the display can be reached. Without
 * a link, it keeps saying why there is none.
 */
export class ShellJoin {
    /** Find the page's elements.
     *
     * @param {object} options - What it works on.
     * @param {PresenterApi} options.api - The published API, which is given the link.
     * @param {Document} options.document - The page.
     * @param {Window} options.window - The page's window.
     */
    constructor({api, document, window}) {
        this.api = api;
        this.window = window;
        // Cast: the shell's page has both.
        this.workspace = /** @type {HTMLElement} */ (document.querySelector(".sozi-workspace"));
        this.notice = /** @type {HTMLElement} */ (
            document.querySelector(".sozi-connection-notice")
        );

        /** Name the link's status in the notice, or hide it once the display can be reached.
         * Without a link the notice keeps saying why there is none.
         *
         * @param {string} status - One of `TransportStatus`.
         */
        this.onStatus = status => {
            if (!this.api.link) {
                return;
            }
            if (status === TransportStatus.connected) {
                this.notice.hidden = true;
            } else if (status === TransportStatus.closed) {
                this.show(NOTICE.notConnected);
            } else {
                this.show(statusText(status));
            }
        };

        // Reloading means that a new link never meets half-torn state.
        this.reload = () => window.location.reload();
    }

    /** Read the link, name the deck to the previews, and listen for what comes next. */
    start() {
        this.window.addEventListener("hashchange", this.reload);
        this.api.on(PresenterEvents.status, this.onStatus);
        this.registerWorker();

        const link = this.readLink();
        if (!link) {
            return;
        }
        this.api.link = link;
        this.show(NOTICE.notConnected);
        // The previews read the deck here when they are drawn. Offline, one would show the
        // browser's error page, so they stay empty until the browser can load the deck.
        if (this.window.navigator.onLine) {
            this.workspace.dataset.deck = link.deck;
        } else {
            this.window.addEventListener("online", this.reload);
        }
    }

    /** Read the pairing link, and say so when there is no good one.
     *
     * @returns {?ShellLink} The link, or null.
     */
    readLink() {
        try {
            const link = readShellLink(this.window.location.hash);
            if (!link) {
                this.show(NOTICE.noLink);
            }
            return link;
        } catch {
            this.show(NOTICE.refused);
            return null;
        }
    }

    /** Say something in the notice.
     *
     * @param {string} text - What to say.
     */
    show(text) {
        this.notice.textContent = text;
        this.notice.hidden = false;
    }

    /** Ask for the service worker; without one, the shell works as long as it is online. */
    registerWorker() {
        const {serviceWorker} = this.window.navigator;
        if (serviceWorker) {
            serviceWorker.register("sw.js").catch(error => this.window.reportError(error));
        }
    }

    /** Remove every listener it added. */
    dispose() {
        this.window.removeEventListener("hashchange", this.reload);
        this.window.removeEventListener("online", this.reload);
        this.api.off(PresenterEvents.status, this.onStatus);
    }
}
