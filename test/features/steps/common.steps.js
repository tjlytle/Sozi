/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps any page can use: the screenshot QA shows on the PR.

import {Then} from "@cucumber/cucumber";
import path from "node:path";
import {SCREENSHOTS} from "../support/world.js";

Then("a screenshot {string} is saved", async function (name) {
    // A presenter scenario shoots the presenter page, a player scenario the deck page.
    const page = this.presenter ?? this.deck;
    await page.screenshot({path: path.join(SCREENSHOTS, `${name}.png`)});
});
