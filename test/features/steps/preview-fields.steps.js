/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for fields a person types into inside a presenter preview (#280).

import {Then, When} from "@cucumber/cucumber";
import {expect} from "playwright/test";
import {WAIT, previewFrame} from "./workspace.steps.js";

// The space a browser may write into editable content for a typed one.
const NO_BREAK_SPACE = new RegExp(String.fromCharCode(0xa0), "g");

/**
 * Click the element with an id in a preview once the presenter has made it a preview.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The preview's title.
 * @param {string} id - The id of the element to click.
 * @returns {Promise<import("playwright").Locator>} The clicked element.
 */
async function clickInPreview(page, title, id) {
    const frame = await previewFrame(page, title);
    // The preview guards its keys only once the presenter has made it a preview.
    await frame.waitForFunction(
        () => window.sozi?.presentation?.enableKeyboardNavigation === false,
        undefined,
        WAIT
    );
    const element = frame.locator(`#${id}`);
    await element.click(WAIT);
    return element;
}

When("the field {string} in the {string} preview is clicked", async function (id, title) {
    const field = await clickInPreview(this.presenter, title, id);
    await expect(field).toBeFocused();
});

// A click on a child of a field, where the field, not the child, should take the focus.
When("the element {string} in the {string} preview is clicked", async function (id, title) {
    await clickInPreview(this.presenter, title, id);
});

Then("the field {string} in the {string} preview has the focus", async function (id, title) {
    const frame = await previewFrame(this.presenter, title);
    await expect(frame.locator(`#${id}`)).toBeFocused(WAIT);
});

// Where the caret lands after a focus given by hand is up to the browser, so the typed
// text may sit before or after the field's own text.
Then(
    "the field {string} in the {string} preview contains {string}",
    async function (id, title, text) {
        const frame = await previewFrame(this.presenter, title);
        const field = frame.locator(`#${id}`);
        await expect
            .poll(async () =>
                (await field.evaluate(element => element.textContent ?? "")).replace(
                    NO_BREAK_SPACE,
                    " "
                )
            )
            .toContain(text);
    }
);

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
