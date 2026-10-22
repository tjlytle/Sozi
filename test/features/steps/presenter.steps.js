/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the presenter page: opening it, moving the talk, reading what it shows.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import path from "node:path";
import {expect} from "playwright/test";
import {SCREENSHOTS, builtDeck} from "../support/world.js";

Given("the {string} deck is built", function (fixture) {
    builtDeck(fixture);
    this.fixture = fixture;
});

Given("the presenter page is open", async function () {
    await this.openPresenter(this.fixture);
    await expect(this.presenter.locator(".sozi-current-index")).not.toBeEmpty();
});

When("the next button is pressed", async function () {
    await this.presenter.locator("#sozi-next-btn").click();
});

When("the previous button is pressed", async function () {
    await this.presenter.locator("#sozi-previous-btn").click();
});

When("the key {string} is pressed on the presenter page", async function (key) {
    await this.presenter.keyboard.press(key);
});

When("the audience transition has finished", async function () {
    // Let the audience window handle any message already posted to it before looking.
    await this.audience.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
    await expect
        .poll(() => this.audience.evaluate(() => window.sozi.player.animator.running))
        .toBe(false);
});

Then("the frame counter reads {string}", async function (text) {
    const [index, length] = text.split("/").map(s => s.trim());
    await expect(this.presenter.locator(".sozi-current-index")).toHaveText(index);
    await expect(this.presenter.locator(".sozi-presentation-length")).toHaveText(length);
});

Then("the notes title is {string}", async function (title) {
    await expect(this.presenter.locator(".sozi-notes-title")).toHaveText(title);
});

Then("the audience window is on frame {string}", async function (title) {
    await expect
        .poll(() => this.audience.evaluate(() => window.sozi.player.currentFrame.title))
        .toBe(title);
    assert.ok(this.audience, "the audience window is open");
});

Then("a screenshot {string} is saved", async function (name) {
    await this.presenter.screenshot({path: path.join(SCREENSHOTS, `${name}.png`)});
});
