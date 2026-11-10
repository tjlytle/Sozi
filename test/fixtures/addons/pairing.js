/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A display add-on: what the pairing overlay shows.

(() => {
    /** @type {any} */ (window).sozi.display.registerPairing({
        render(element) {
            element.textContent = "Scan to join";
        }
    });
})();
