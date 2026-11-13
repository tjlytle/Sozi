/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

/** How long a download has to start before its URL goes away: some phones are slow to look.
 *
 * @readonly
 * @default
 * @type {number}
 */
const REVOKE_DELAY_MS = 40000;

/** The files the presenter page hands to the browser to save.
 *
 * The presenter is a web page with no way to write a file, so a file leaves as a download from
 * a blob URL. Each URL is revoked once its download has had time to start, or on `dispose`.
 */
export class Downloads {
    /** Downloads from a page.
     *
     * @param {Document} doc - The page the download's link is made in.
     * @param {any} host - Where `Blob`, `URL` and the timers come from: the window.
     */
    constructor(doc, host) {
        this.doc = doc;
        this.host = host;

        /** The URL of each download that has not had its time yet, with its timer.
         *
         * @type {Map<string, any>}
         */
        this.waiting = new Map();
    }

    /** Download a text file, and let its URL go once the download has had time to start.
     *
     * @param {string} fileName - The file's name.
     * @param {string} text - Its content.
     * @param {string} type - Its media type, as `application/json`.
     */
    download(fileName, text, type) {
        const {Blob, URL, setTimeout} = this.host;
        const url = URL.createObjectURL(new Blob([text], {type}));
        const anchor = this.doc.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        const timer = setTimeout(() => this.release(url), REVOKE_DELAY_MS);
        this.waiting.set(url, timer);
    }

    /** Revoke a download's URL.
     *
     * @param {string} url - The URL.
     */
    release(url) {
        this.host.clearTimeout(this.waiting.get(url));
        this.waiting.delete(url);
        this.host.URL.revokeObjectURL(url);
    }

    /** Revoke every URL still waiting. */
    dispose() {
        for (const url of [...this.waiting.keys()]) {
            this.release(url);
        }
    }
}
