/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A custom file for both pages: leaves its name where the steps read it.

(() => {
    const page = /** @type {any} */ (window);
    page.addonMarkers = [...(page.addonMarkers ?? []), "marker.js"];
})();
