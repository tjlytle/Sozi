/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the editor: open a deck in the Electron app, act on the timeline and the
// properties panel, read back the DOM and the files on disk.
// The selectors come from src/js/view/Timeline.js (th.sozi-timeline__frame-index,
// th.sozi-timeline__frame-title, and the buttons titled "Create a new frame" and "Delete the
// selected frames", both defined in the timeline's header, not in src/js/view/Toolbar.js),
// src/js/view/Properties.js (#field-title) and the key map in src/js/model/Preferences.js.
// The buttons are found by their English titles, so the run needs the default (English) locale.

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
    await expect(frameTitleCells(this.window).nth(index - 1)).toHaveClass(
        /(^|\s)sozi-timeline__cell--selected(\s|$)/
    );
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

// The properties panel, the toolbar and the language. The toolbar is
// #sozi-editor-view-toolbar (src/index-electron.html); its buttons are found by their titles,
// which are translated, so a scenario names them in the language it expects. A field is
// #field-<property> (src/js/view/Properties.js); it commits on change. Each layer of the
// preview is wrapped by src/js/player/Camera.js in a group that carries its opacity.

/** The ids of the layers of the basic deck. */
const BASIC_LAYERS = ["layer1", "layer2"];

Given(
    "the editor is open on a copy of the basic deck with the system language {string}",
    async function (lang) {
        this.editor = await launchEditor("basic", {lang});
        this.window = this.editor.window;
    }
);

When("the field {string} is changed to {string}", async function (property, value) {
    await this.window.locator(`#field-${property}`).evaluate((field, v) => {
        const input = /** @type {HTMLInputElement} */ (field);
        input.value = v;
        input.dispatchEvent(new Event("input", {bubbles: true}));
        input.dispatchEvent(new Event("change", {bubbles: true}));
    }, value);
});

When("the toolbar button {string} is pressed", async function (title) {
    await this.window.locator(`#sozi-editor-view-toolbar button[title="${title}"]`).click();
});

When("the language {string} is chosen", async function (lang) {
    await this.window.locator("#field-language").selectOption(lang);
});

Then("the toolbar has a button titled {string}", async function (title) {
    await expect(
        this.window.locator(`#sozi-editor-view-toolbar button[title="${title}"]`)
    ).toHaveCount(1);
});

Then("the field {string} reads {string}", async function (property, value) {
    await expect(this.window.locator(`#field-${property}`)).toHaveValue(value);
});

Then("every layer in the preview has opacity {string}", async function (opacity) {
    await expect
        .poll(() =>
            this.window.evaluate(
                ids =>
                    ids.map(id =>
                        /** @type {?Element} */ (
                            document.querySelector(`#sozi-editor-view-preview #${id}`)?.parentNode
                        )?.getAttribute("opacity")
                    ),
                BASIC_LAYERS
            )
        )
        .toEqual(BASIC_LAYERS.map(() => opacity));
});

Then(
    "the presentation file on disk has frame {int} with {string} {int}",
    async function (index, property, value) {
        const file = this.editor.deck.json;
        await expect
            .poll(() => readPresentation(file)?.frames?.[index - 1]?.[property], {timeout: 5000})
            .toBe(value);
    }
);

Then(
    "the presentation file on disk has frame {int} with opacity {float} on every layer",
    async function (index, opacity) {
        const file = this.editor.deck.json;
        await expect
            .poll(
                () => {
                    const states = readPresentation(file)?.frames?.[index - 1]?.cameraStates;
                    return BASIC_LAYERS.map(id => states?.[id]?.opacity);
                },
                {timeout: 5000}
            )
            .toEqual(BASIC_LAYERS.map(() => opacity));
    }
);

// Layers in the preview (#240). A layer's row in the timeline holds its eye
// (i.sozi-timeline__visibility, fa-eye while visible, fa-eye-slash while hidden) and its label
// (th.sozi-timeline__layer-label); only the deck's editable layers have a row. The preview
// shows the deck's own layer groups, found by their inkscape:label; whether one is displayed
// is read from its computed style, so an author's inline style="display:inline" counts.

/** The eye of a layer's row in the timeline, in the state it shows.
 *
 * @param {import("playwright").Page} window - The editor window.
 * @param {string} label - The layer's label.
 * @param {string} icon - "fa-eye" for a visible layer, "fa-eye-slash" for a hidden one.
 * @returns {import("playwright").Locator} - The eye.
 */
function layerEye(window, label, icon) {
    const name = window.locator("th.sozi-timeline__layer-label").getByText(label, {exact: true});
    return window.locator("tr", {has: name}).locator(`i.sozi-timeline__visibility.${icon}`);
}

/** The computed display of a layer group in the preview.
 *
 * @param {import("playwright").Page} window - The editor window.
 * @param {string} label - The layer's inkscape:label.
 * @returns {Promise<?string>} - Its display, or null when the preview has no such layer.
 */
function layerDisplay(window, label) {
    return window.evaluate(l => {
        const group = [...document.querySelectorAll("#sozi-editor-view-preview g")].find(
            g => g.getAttribute("inkscape:label") === l
        );
        return group ? getComputedStyle(group).display : null;
    }, label);
}

Given("the editor is open on a copy of the {string} deck", async function (fixture) {
    this.editor = await launchEditor(fixture);
    this.window = this.editor.window;
});

// The notes field and the notification panel. The notes field is #field-notes, a
// content-editable section that commits on blur, and its help is the icon titled
// "Edit presenter notes. ..." (src/js/view/Properties.js). The panel is #message, with a
// title and a body (src/index-electron.html, src/js/Controller.js).

When("the help of the notes field is clicked", async function () {
    await this.window.locator('.sozi-properties__help[title^="Edit presenter notes."]').click();
});

When("the notes field is changed to {string}", async function (html) {
    const field = this.window.locator("#field-notes");
    await field.focus();
    await field.evaluate((element, value) => {
        element.innerHTML = value;
    }, html);
    // The field commits on blur.
    await field.blur();
});

When("the presentation is saved", async function () {
    await this.window.keyboard.press("Control+S");
});

Then("the notes field shows {string} in bold", async function (text) {
    await expect(this.window.locator("#field-notes :is(b, strong)")).toHaveText(text);
});

Then("the notification title reads {string}", async function (text) {
    await expect(this.window.locator("#message .sozi-editor__message-title")).toHaveText(text);
});

Then("the notification shows the line {string}", async function (line) {
    const body = this.window.locator("#message .sozi-editor__message-body");
    await expect(body).toBeVisible();
    // The entry must be a line of the body's text as well as a line on screen: an entry
    // set apart by markup (<br>) is a line on screen but not a line of text.
    await expect
        .poll(() =>
            body.evaluate(element => ({
                shown: /** @type {HTMLElement} */ (element).innerText
                    .split("\n")
                    .map(s => s.trim()),
                text: (element.textContent ?? "").split("\n").map(s => s.trim())
            }))
        )
        .toEqual({shown: expect.arrayContaining([line]), text: expect.arrayContaining([line])});
});

Then("the presentation JSON file on disk contains {string}", async function (text) {
    const file = this.editor.deck.json;
    await expect
        .poll(() => fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(text), {
            timeout: 5000
        })
        .toBe(true);
});

When("the layer {string} is hidden in the timeline", async function (label) {
    await layerEye(this.window, label, "fa-eye").click();
});

When("the layer {string} is shown in the timeline", async function (label) {
    await layerEye(this.window, label, "fa-eye-slash").click();
});

Then("the layer {string} is not displayed in the preview", async function (label) {
    await expect.poll(() => layerDisplay(this.window, label)).toBe("none");
});

Then("the layer {string} is displayed in the preview", async function (label) {
    await expect
        .poll(async () => {
            const display = await layerDisplay(this.window, label);
            return display !== null && display !== "none";
        })
        .toBe(true);
});
