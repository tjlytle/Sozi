/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the editor: open a deck in the Electron app, act on the timeline and the
// properties panel, read back the DOM and the files on disk.
// The selectors come from src/js/view/Timeline.js (th.sozi-timeline__frame-index, th.sozi-timeline__frame-title, and the
// buttons titled "Create a new frame" and "Delete the selected frames", both defined in the
// timeline's header, not in src/js/view/Toolbar.js), src/js/view/Properties.js (#field-title)
// and the key map in src/js/model/Preferences.js. The buttons are found by their English
// titles, so the run needs the default (English) locale.

import {Given, Then, When} from "@cucumber/cucumber";
import fs from "node:fs";
import {expect} from "playwright/test";
import {launchEditor} from "../support/electron.js";

/** The frame number cells of the timeline, one per frame.
 *
 * @param {import("playwright").Page} window - The editor window.
 * @returns {import("playwright").Locator} - The cells.
 */
function frameIndexCells(window) {
    return window.locator(".sozi-timeline__top-right th.sozi-timeline__frame-index");
}

/** The frame title cells of the timeline, one per frame.
 *
 * @param {import("playwright").Page} window - The editor window.
 * @returns {import("playwright").Locator} - The cells.
 */
function frameTitleCells(window) {
    return window.locator(".sozi-timeline__top-right th.sozi-timeline__frame-title");
}

/** Read the presentation file of the deck from disk.
 *
 * @param {string} file - The path of the .sozi.json file.
 * @returns {any} - The parsed presentation, or null while it is being written.
 */
function readPresentation(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

Given("the editor is open on a copy of the basic deck", async function () {
    this.editor = await launchEditor("basic");
    this.window = this.editor.window;
});

When("frame {int} is clicked in the timeline", async function (index) {
    await frameTitleCells(this.window)
        .nth(index - 1)
        .click();
});

When("the timeline button {string} is pressed", async function (title) {
    await this.window.locator(`button[title="${title}"]`).click();
});

When("the key {string} is pressed in the editor", async function (key) {
    await this.window.keyboard.press(key);
});

When("the title field is changed to {string}", async function (title) {
    await this.window.locator("#field-title").fill(title);
    // The field commits on change, which fires when it loses the focus.
    await this.window.locator("#field-title").press("Tab");
});

When("the selection is inserted before frame {int}", async function (index) {
    const cell = frameIndexCells(this.window).nth(index - 1);
    // The insert icons are shown only while the cell is hovered.
    await cell.hover();
    await cell.locator("i.sozi-timeline__insert-before").click();
});

Then("the timeline shows {int} frames", async function (count) {
    await expect(frameIndexCells(this.window)).toHaveCount(count);
    await expect(frameTitleCells(this.window)).toHaveCount(count);
});

Then("the timeline titles are {string}", async function (titles) {
    await expect(frameTitleCells(this.window)).toHaveText(titles.split(/,\s*/));
});

Then("frame {int} is the selected frame", async function (index) {
    await expect(frameTitleCells(this.window).nth(index - 1)).toHaveClass(/\bselected\b/);
    await expect(
        this.window.locator(
            ".sozi-timeline__top-right th.sozi-timeline__frame-title.sozi-timeline__cell--selected"
        )
    ).toHaveCount(1);
});

Then("no frame is selected", async function () {
    await expect(
        this.window.locator(
            ".sozi-timeline__top-right th.sozi-timeline__frame-title.sozi-timeline__cell--selected"
        )
    ).toHaveCount(0);
});

Then("the selected frame's title field reads {string}", async function (title) {
    await expect(this.window.locator("#field-title")).toHaveValue(title);
});

Then("the window title contains {string}", async function (text) {
    await expect(this.window).toHaveTitle(new RegExp(text));
});

Then(
    "the presentation file on disk has frame {int} titled {string}",
    async function (index, title) {
        const file = this.editor.deck.json;
        await expect
            .poll(() => readPresentation(file)?.frames?.[index - 1]?.title, {timeout: 5000})
            .toBe(title);
    }
);

Then("the presentation HTML file on disk contains {string}", async function (text) {
    const file = this.editor.deck.svg.replace(/\.svg$/, ".sozi.html");
    await expect
        .poll(() => fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(text))
        .toBe(true);
});
