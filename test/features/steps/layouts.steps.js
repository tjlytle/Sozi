/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the layouts a deck carries (#33): opening at a width, the notice, Save as preset,
// putting the file it downloads in a deck, and the list in the editor's properties.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {expect} from "playwright/test";
import {buildDeck, copyDeck} from "../support/decks.js";
import {WAIT, savedLayout} from "../support/panels.js";
import {VIEWPORT} from "../support/world.js";

const require = createRequire(import.meta.url);
const {runSozi} = require("../../cli/helpers.js");

// What the page draws for a preset, as the plan of #33 names it or as these steps ask of it.
const NOTICE = ".sozi-layout-notice";
const FORM = ".sozi-preset-form";
const PRESET_NAME = ".sozi-layout-presets__name";

// How long a save that waits for the layout to settle, or a move of the talk that went through
// the audience window, has to show.
const SETTLE_MS = 500;

// Seven runs of the CLI, which starts Electron each time.
const CLI_STEP = {timeout: 120000};

/** Open the form that saves a preset.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {Promise<import("playwright").Locator>} - The form.
 */
async function openPresetForm(page) {
    await page.getByRole("button", {name: "Save as preset"}).click(WAIT);
    const form = page.locator(FORM);
    await expect(form).toBeVisible();
    return form;
}

/** Run the CLI in a deck's directory, and fail the step if it fails.
 *
 * @param {{dir: string}} deck - The deck.
 * @param {string[]} args - The arguments after `--cli`.
 */
function sozi(deck, args) {
    const run = runSozi(args, {cwd: deck.dir});
    assert.equal(run.code, 0, `sozi ${args.join(" ")}:\n${run.stdout}\n${run.stderr}`);
}

Given("the presenter page is open at {int} by {int}", async function (width, height) {
    await this.openPresenter(this.fixture, {width, height});
    await this.presenterIsReady();
});

When("the preset form is opened", async function () {
    await openPresetForm(this.presenter);
});

When("{string} is typed as the preset's name", async function (name) {
    await this.presenter.locator(FORM).getByLabel("Name").pressSequentially(name);
    await this.presenter.waitForTimeout(SETTLE_MS);
});

When("the layout is saved as the preset {string} for {string}", async function (name, match) {
    const form = await openPresetForm(this.presenter);
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Match").selectOption(match);
    const download = this.presenter.waitForEvent("download", WAIT);
    await form.getByRole("button", {name: "Save", exact: true}).click(WAIT);
    this.download = await download;
});

When(
    "the downloaded preset is added to the deck with the CLI ahead of the others",
    CLI_STEP,
    async function () {
        // Its own copy: the built decks are shared between the scenarios of a run.
        this.ownDeck = copyDeck(this.fixture);
        const deck = this.ownDeck;
        const file = this.download.suggestedFilename();
        await this.download.saveAs(path.join(deck.dir, file));
        const name = file.split(".").at(-3);
        const json = path.basename(deck.json);
        const {layouts} = JSON.parse(fs.readFileSync(deck.json, "utf8")).presenter;

        // A new preset goes last, so the others come out and go back in behind it.
        for (const other of Object.keys(layouts)) {
            sozi(deck, ["set", json, "--layout", `${other}=`]);
        }
        sozi(deck, ["set", json, "--layout", `${name}=${file}`]);
        for (const [other, preset] of Object.entries(layouts)) {
            const otherFile = `${other}.layout.json`;
            fs.writeFileSync(path.join(deck.dir, otherFile), JSON.stringify(preset));
            sozi(deck, ["set", json, "--layout", `${other}=${otherFile}`]);
        }
    }
);

When("the deck is built again", CLI_STEP, function () {
    this.ownBuild = buildDeck(this.ownDeck);
});

When(
    "the presenter page is opened on a new device at {int} by {int}",
    async function (width, height) {
        await this.openPresenterIn({viewport: VIEWPORT}, this.ownBuild, {width, height});
        await this.presenterIsReady();
    }
);

Then("no layout is saved for the deck", async function () {
    await this.presenter.waitForTimeout(SETTLE_MS);
    assert.equal(await savedLayout(this.presenter), null);
});

Then("the presenter page says the preset {string} could not be used", async function (name) {
    await expect(this.presenter.locator(NOTICE)).toBeVisible(WAIT);
    await expect(this.presenter.locator(NOTICE)).toContainText(name);
});

Then("the presenter page says to run {string}", async function (command) {
    await expect(this.presenter.locator(NOTICE)).toBeVisible(WAIT);
    await expect(this.presenter.locator(NOTICE)).toContainText(command);
});

Then("the file {string} is downloaded", async function (name) {
    assert.equal(this.download.suggestedFilename(), name);
    const preset = JSON.parse(fs.readFileSync(await this.download.path(), "utf8"));
    assert.equal(preset.match, "laptop");
    assert.ok(preset.layout?.dock, "the file holds the dock");
});

Then("the layout presets read {string}", async function (list) {
    const names = list.split(",").map(name => name.trim());
    await expect(this.window.locator(PRESET_NAME)).toHaveText(names, WAIT);
    // The list ends a long pane, and the screenshot that follows has to show it.
    await this.window.locator(PRESET_NAME).last().scrollIntoViewIfNeeded(WAIT);
});
