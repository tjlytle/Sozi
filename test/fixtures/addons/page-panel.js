/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A presenter add-on: a panel that embeds a page next to the deck.

(() => {
    /** @type {any} */ (window).sozi.presenter.registerPanel({
        id: "page",
        title: "Page",
        url: "page.html"
    });
})();
