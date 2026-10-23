/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the presenter page: opening it, moving the talk, reading what it shows.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {expect} from "playwright/test";
import {SCREENSHOTS, builtDeck} from "../support/world.js";

// "Within a frame" in the plan: the previews have this long to take a new shape.
const WITHIN_A_FRAME = 250;

/** What is wrong with the shape of the three previews, empty when nothing is.
 *
 * Each preview iframe must have the given width/height ratio within 1% and fit inside
 * the box that holds it.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {number} ratio - The expected width/height ratio.
 * @returns {Promise<string[]>} - One line per preview that is out of shape.
 */
function previewShapeProblems(page, ratio) {
    return page.evaluate(expected => {
        const problems = [];
        for (const iframe of document.querySelectorAll("iframe")) {
            const own = iframe.getBoundingClientRect();
            const box = /** @type {Element} */ (iframe.parentElement).getBoundingClientRect();
            const actual = own.width / own.height;
            const name = iframe.className;
            if (!(Math.abs(actual / expected - 1) <= 0.01)) {
                problems.push(`${name} is ${own.width}x${own.height}, ratio ${actual}`);
            }
            if (
                own.left < box.left - 1 ||
                own.top < box.top - 1 ||
                own.right > box.right + 1 ||
                own.bottom > box.bottom + 1
            ) {
                problems.push(`${name} overflows its ${box.width}x${box.height} box`);
            }
        }
        return problems;
    }, ratio);
}

Given("the {string} deck is built", function (fixture) {
    builtDeck(fixture);
    this.fixture = fixture;
});

Given("the presenter page is open", async function () {
    await this.openPresenter(this.fixture);
    await expect(this.presenter.locator(".sozi-current-index")).not.toBeEmpty();
});

Given("the presenter page is open without its audience window", async function () {
    // Cast: the Before hook opens a context for every scenario.
    const context = /** @type {import("playwright").BrowserContext} */ (this.context);
    // A stand-in for the audience window that never reports, so no viewport arrives.
    await context.addInitScript(() => {
        window.open = () => /** @type {any} */ ({focus() {}, postMessage() {}});
    });
    this.presenter = await context.newPage();
    await this.presenter.goto(pathToFileURL(builtDeck(this.fixture).presenter).href);
});

When("the audience window is resized to {int} by {int}", async function (width, height) {
    await this.audience.setViewportSize({width, height});
});

When("the presenter page is resized to {int} by {int}", async function (width, height) {
    await this.presenter.setViewportSize({width, height});
});

When("the presenter page is reloaded", async function () {
    await this.presenter.reload();
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

Then("every preview has the audience window's shape", async function () {
    const ratio = await this.audience.evaluate(() => window.innerWidth / window.innerHeight);
    await expect
        .poll(() => previewShapeProblems(this.presenter, ratio), {timeout: WITHIN_A_FRAME})
        .toEqual([]);
});

Then("every preview has the shape {int}:{int}", async function (width, height) {
    await expect
        .poll(() => previewShapeProblems(this.presenter, width / height), {
            timeout: WITHIN_A_FRAME
        })
        .toEqual([]);
});

Then("a screenshot {string} is saved", async function (name) {
    await this.presenter.screenshot({path: path.join(SCREENSHOTS, `${name}.png`)});
});
