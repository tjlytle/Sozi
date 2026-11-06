/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

/**
 * What an add-on registers for the pairing shortcut.
 *
 * @typedef {object} Pairing
 * @property {(element: HTMLElement, display: any) => void} render - Draws into the overlay's
 *   element each time it is shown; it is emptied on hide.
 */

/** The overlay a pairing add-on draws in. `Q` shows it; `Escape` or `Q` again hides it.
 *
 * With no pairing registered, `Q` does nothing.
 */
export class PairingOverlay {
    /** Start listening for the shortcut.
     *
     * @param {HTMLElement} element - The `.sozi-pairing` element of the page.
     * @param {any} host - The window the deck plays in.
     * @param {any} display - The `sozi.display` a pairing's render receives.
     */
    constructor(element, host, display) {
        this.element = element;
        this.host = host;
        this.display = display;

        /** What the overlay shows, null until an add-on registers it.
         *
         * @type {?Pairing}
         */
        this.pairing = null;

        this.onKeyDown = evt => this.handleKey(evt);
        host.addEventListener("keydown", this.onKeyDown);
    }

    /** Say what the overlay shows.
     *
     * @param {Pairing} pairing - The pairing.
     */
    setPairing(pairing) {
        this.pairing = pairing;
    }

    /** Act on a key: `Q` toggles the overlay, `Escape` hides it while it is shown.
     *
     * @param {KeyboardEvent} evt - The event.
     */
    handleKey(evt) {
        if (evt.altKey || evt.ctrlKey || evt.metaKey || !this.pairing) {
            return;
        }
        const shown = !this.element.hidden;
        const key = evt.key.toLowerCase();
        if (key === "q" && !shown) {
            this.show();
        } else if (shown && (key === "q" || key === "escape")) {
            this.hide();
        } else {
            return;
        }
        evt.preventDefault();
    }

    /** Draw the pairing and show it. */
    show() {
        /** @type {Pairing} */ (this.pairing).render(this.element, this.display);
        this.element.hidden = false;
    }

    /** Hide the overlay and empty it. */
    hide() {
        this.element.hidden = true;
        this.element.replaceChildren();
    }

    /** Hide the overlay and stop listening for the shortcut. */
    dispose() {
        this.hide();
        this.host.removeEventListener("keydown", this.onKeyDown);
    }
}
