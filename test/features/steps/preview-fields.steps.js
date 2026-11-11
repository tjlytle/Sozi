/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for fields a person types into inside a presenter preview (#280).

import {Then, When} from "@cucumber/cucumber";
import {expect} from "playwright/test";
import {WAIT} from "../support/panels.js";
import {previewFrame} from "./workspace.steps.js";

// The space a browser may write into editable content for a typed one.
const NO_BREAK_SPACE = new RegExp(String.fromCharCode(0xa0), "g");

When("the field {string} in the {string} preview is clicked", async function (id, title) {
    const frame = await previewFrame(this.presenter, title);
    // The preview guards its keys only once the presenter has made it a preview.
    await frame.waitForFunction(
        () => window.sozi?.presentation?.enableKeyboardNavigation === false,
        undefined,
        WAIT
    );
    const field = frame.locator(`#${id}`);
    await field.click(WAIT);
    await expect(field).toBeFocused();
});

When("the text {string} is typed on the presenter page", async function (text) {
    await this.presenter.keyboard.type(text);
});

Then("the field {string} in the {string} preview reads {string}", async function (id, title, text) {
    const frame = await previewFrame(this.presenter, title);
    const field = frame.locator(`#${id}`);
    // An input's text is its value; editable content's is its text.
    await expect
        .poll(async () => {
            const read = await field.evaluate(element =>
                element instanceof HTMLInputElement ? element.value : (element.textContent ?? "")
            );
            return read.replace(NO_BREAK_SPACE, " ");
        })
        .toBe(text);
});
