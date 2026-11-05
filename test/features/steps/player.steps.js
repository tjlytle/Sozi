/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the exported player page: opening it, pressing keys, posting messages, the
// mouse, the frame list and the media. The view is read through window.sozi (the first
// camera) and compared with where it was when the page opened. The selectors come from
// src/templates/player.html (.sozi-frame-list, .sozi-frame-number) and src/js/player/Media.js,
// which turns sozi:video and sozi:audio into <video> and <audio> elements.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {expect} from "playwright/test";

/** A point on the slide, clear of the frame number and the frame list. */
const SLIDE = {x: 640, y: 400};

/** A point on the slide, far from the frame list when it is open. */
const FAR_FROM_FRAME_LIST = {x: 1200, y: 700};

/** Let the page run two animation frames, so that a handler that has nothing to do is seen
 * to have done nothing.
 *
 * @param {import("playwright").Page} page - The deck page.
 */
async function settle(page) {
    await page.evaluate(
        () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
}

/** Where the frame list is: its left and right edges on screen.
 *
 * @param {import("playwright").Page} page - The deck page.
 * @returns {Promise<{left: number, right: number}>} - The edges, in pixels.
 */
function frameListEdges(page) {
    return page.evaluate(() => {
        const rect = /** @type {Element} */ (
            document.querySelector(".sozi-frame-list")
        ).getBoundingClientRect();
        return {left: Math.round(rect.left), right: Math.round(rect.right)};
    });
}

/** Whether a media element of the page is paused.
 *
 * @param {import("playwright").Page} page - The deck page.
 * @param {string} tag - "video" or "audio".
 * @returns {Promise<?boolean>} - Its paused flag, or null when there is no such element.
 */
function mediaPaused(page, tag) {
    return page.evaluate(t => {
        const media = /** @type {?HTMLMediaElement} */ (document.querySelector(t));
        return media ? media.paused : null;
    }, tag);
}

Given("the deck page is open", async function () {
    await this.openDeck(this.fixture);
});

Given("the deck turns mouse zoom off", async function () {
    await this.deck.evaluate(() => {
        /** @type {any} */ (window).sozi.presentation.enableMouseZoom = false;
    });
});

When("the slide is clicked", async function () {
    await this.deck.mouse.click(SLIDE.x, SLIDE.y);
});

When("the slide is right-clicked", async function () {
    await this.deck.mouse.click(SLIDE.x, SLIDE.y, {button: "right"});
});

When("the slide is clicked with the middle button", async function () {
    await this.deck.mouse.click(SLIDE.x, SLIDE.y, {button: "middle"});
});

When("the wheel turns up over the slide", async function () {
    await this.deck.mouse.move(SLIDE.x, SLIDE.y);
    await this.deck.mouse.wheel(0, -100);
});

When("the wheel turns up over the slide with Shift held", async function () {
    await this.deck.mouse.move(SLIDE.x, SLIDE.y);
    await this.deck.keyboard.down("Shift");
    await this.deck.mouse.wheel(0, -100);
    await this.deck.keyboard.up("Shift");
});

When("the slide is dragged {int} pixels to the left", async function (distance) {
    await this.deck.mouse.move(SLIDE.x, SLIDE.y);
    await this.deck.mouse.down();
    await this.deck.mouse.move(SLIDE.x - distance, SLIDE.y, {steps: 10});
    await this.deck.mouse.up();
});

When("the frame number is clicked", async function () {
    await this.deck.locator(".sozi-frame-number").click();
});

When("the frame list entry {string} is clicked", async function (title) {
    await this.deck.locator(`.sozi-frame-list a[title="${title}"]`).click();
});

When("the mouse leaves the frame list", async function () {
    await this.deck.locator(".sozi-frame-list a").first().hover();
    await this.deck.mouse.move(FAR_FROM_FRAME_LIST.x, FAR_FROM_FRAME_LIST.y, {steps: 5});
});

When("the video is clicked", async function () {
    await this.deck.locator("video").click();
});

Then("the view is zoomed in", async function () {
    const before = this.initialView.width;
    await expect.poll(async () => (await this.readView()).width).toBeLessThan(before);
});

Then("the view is not zoomed", async function () {
    await settle(this.deck);
    assert.equal((await this.readView()).width, this.initialView.width);
});

Then("the view is rotated", async function () {
    const before = this.initialView.angle;
    await expect.poll(async () => (await this.readView()).angle).not.toBe(before);
});

Then("the view has moved", async function () {
    const {cx, cy} = this.initialView;
    await expect
        .poll(async () => {
            const view = await this.readView();
            return view.cx !== cx || view.cy !== cy;
        })
        .toBe(true);
});

Then("the frame list is open", async function () {
    await expect.poll(async () => (await frameListEdges(this.deck)).left).toBe(0);
});

Then("the frame list is closed", async function () {
    await expect.poll(async () => (await frameListEdges(this.deck)).right).toBeLessThanOrEqual(0);
});

Then("the {word} is playing", async function (tag) {
    await expect.poll(() => mediaPaused(this.deck, tag)).toBe(false);
});

Then("the {word} is paused", async function (tag) {
    await expect.poll(() => mediaPaused(this.deck, tag)).toBe(true);
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

// A message in the protocol's shape (docs/presenter-protocol.md): fields beside the name, no args.
When("a protocol message {string} is posted to the page", async function (name) {
    await this.deck.evaluate(n => window.postMessage({name: n}, "*"), name);
});

When(
    "a protocol message {string} with index {int} is posted to the page",
    async function (name, index) {
        await this.deck.evaluate(
            ([n, i]) => window.postMessage({name: n, index: i}, "*"),
            [name, index]
        );
    }
);

// The player changes currentFrame only when a transition ends, so the frame is read once
// the player is at rest; a move that has started is not mistaken for staying put.
Then("the player is on frame {string}", async function (title) {
    await expect
        .poll(() =>
            this.deck.evaluate(() => {
                const player = /** @type {any} */ (window).sozi.player;
                return player.animator.running ? null : player.currentFrame.title;
            })
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
