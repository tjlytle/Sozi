/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The step that makes fails.feature fail, for test/unit/support/world.test.js.

import {Then} from "@cucumber/cucumber";

Then("this step fails on purpose", function () {
    throw new Error("fails on purpose");
});
