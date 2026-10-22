/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the exported player page: opening it, pressing keys, posting messages.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {expect} from "playwright/test";

Given("the deck page is open", async function () {
    await this.openDeck(this.fixture);
});

When("the key {string} is pressed", async function (key) {
    await this.deck.keyboard.press(key);
});

When("the player is asked to jump to frame index {int}", async function (index) {
    await this.deck.evaluate(i => /** @type {any} */ (window).sozi.player.jumpToFrame(i), index);
});

When(
    "a message {string} with the argument {int} is posted to the page",
    async function (name, arg) {
        await this.deck.evaluate(
            ([n, a]) => window.postMessage({name: n, args: [a]}, "*"),
            [name, arg]
        );
    }
);

When("a message {string} with no arguments is posted to the page", async function (name) {
    await this.deck.evaluate(n => window.postMessage({name: n}, "*"), name);
});

Then("the player is on frame {string}", async function (title) {
    await expect
        .poll(() =>
            this.deck.evaluate(() => /** @type {any} */ (window).sozi.player.currentFrame.title)
        )
        .toBe(title);
});

Then("the page title contains {string}", async function (text) {
    assert.match(await this.deck.title(), new RegExp(text));
});

Then("the URL hash names frame {string}", async function (frameId) {
    await expect.poll(() => this.deck.evaluate(() => window.location.hash)).toBe(`#${frameId}`);
});

Then("the presentation has {int} frames", async function (count) {
    const length = await this.deck.evaluate(
        () => /** @type {any} */ (window).sozi.presentation.frames.length
    );
    assert.equal(length, count);
});
