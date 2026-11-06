/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the Clock panel (#32): moving the pages' clocks on and reading what the panel shows.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {expect} from "playwright/test";
import {tabOf, WAIT} from "./workspace.steps.js";

/** @typedef {import("../support/world.js").SoziWorld} SoziWorld */

// What the Clock panel draws. The plan of #32 names the first two; the others are this file's
// names for the parts it leaves open, kept here so that they change in one place.
const CLOCK = ".sozi-clock";
const ELAPSED = ".sozi-clock__elapsed";
const TIME_OF_DAY = ".sozi-clock__time";
const FRAME = ".sozi-clock__frame";
const REMAINING = ".sozi-clock__remaining";
const TARGET_LABEL = "Target (min)";

const NEAR = /sozi-clock__elapsed--near/;
const OVER = /sozi-clock__elapsed--over/;

// "About" in the plan: within this long, in milliseconds.
const ABOUT_MS = 2000;

// How far apart two surfaces may read, in seconds.
const SAME_TIME_SECONDS = 1;

// How far the clocks move to see whether the elapsed time is still counting, in milliseconds.
const STILL_MS = 10000;

// Longer than the panel's 250 ms tick, in real time.
const TICK_MS = 300;

// A message posted to the audience window has this long to arrive, in milliseconds.
const ARRIVE_MS = 50;

// Long enough for a key that moved the talk to have reached the display, in milliseconds.
const SETTLE_MS = 300;

// The smallest height of the digits a person can read across a lectern, in CSS pixels.
const READABLE_PX = 48;

// How far a box may stick out of the one that holds it, in pixels.
const TOLERANCE = 1;

const MINUTE_MS = 60000;

// Half a day in minutes: a clock on 12 hours and a clock on 24 read the same modulo this.
const HALF_DAY_MINUTES = 720;

/** The number of seconds a duration reads.
 *
 * @param {?string} text - The duration, like "04:12" or "1:04:12".
 * @returns {number} - The seconds, NaN if the text is not a duration.
 */
function secondsIn(text) {
    const match = /^\s*(\d+:)?\d+:\d+/.exec(text ?? "");
    return match
        ? match[0].split(":").reduce((seconds, part) => seconds * 60 + Number(part), 0)
        : NaN;
}

/** The elapsed time a surface reads, in seconds.
 *
 * @param {import("playwright").Page} page - The surface.
 * @returns {Promise<number>} - The seconds.
 */
async function elapsedSeconds(page) {
    return secondsIn(await page.locator(ELAPSED).textContent(WAIT));
}

/** Check that a surface has drawn the elapsed time, so that a panel that is not there fails
 * with its name and not with a poll that ran out of time.
 *
 * @param {import("playwright").Page} page - The surface.
 */
async function expectElapsedDrawn(page) {
    await expect(page.locator(ELAPSED)).toBeAttached(WAIT);
}

/** How far a reading may be from the time the scenario moved the clocks by, in seconds.
 *
 * The clocks keep running between steps, so the real time the scenario took is on top of the
 * plan's two seconds, whatever the machine's speed.
 *
 * @param {SoziWorld} world - The scenario.
 * @returns {number} - The seconds.
 */
function aboutSeconds(world) {
    // Cast: the Background installs the clocks and notes when.
    const startedAt = /** @type {any} */ (world).clocksInstalledAt;
    return (ABOUT_MS + Date.now() - startedAt) / 1000;
}

/** Move the clocks of every page of the scenario on.
 *
 * What a step before this one sent has to arrive first: a command that reaches the display
 * after the jump does not count the jump, and a transition does not start the jump midway.
 *
 * @param {SoziWorld} world - The scenario.
 * @param {number} ms - How far, in milliseconds.
 */
async function moveClocksOn(world, ms) {
    // Cast: the scenario opened the audience window.
    const audience = /** @type {import("playwright").Page} */ (world.audience);
    if (!audience.isClosed()) {
        await audience.evaluate(
            wait => new Promise(resolve => setTimeout(resolve, wait)),
            ARRIVE_MS
        );
        await expect
            .poll(() =>
                audience.evaluate(() => /** @type {any} */ (window).sozi.player.animator.running)
            )
            .toBe(false);
    }
    // Cast: the Before hook opens a context for every scenario.
    await /** @type {import("playwright").BrowserContext} */ (world.context).clock.fastForward(ms);
}

/** Check that a surface's elapsed time does not count when the clocks move on.
 *
 * @param {SoziWorld} world - The scenario.
 * @param {import("playwright").Page} page - The surface.
 */
async function expectElapsedHolds(world, page) {
    await expectElapsedDrawn(page);
    await expect
        .poll(async () => {
            const before = await elapsedSeconds(page);
            await moveClocksOn(world, STILL_MS);
            await page.waitForTimeout(TICK_MS);
            return (await elapsedSeconds(page)) - before;
        })
        .toBe(0);
}

/** A field of the Clock panel that holds the target.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {import("playwright").Locator} - The field.
 */
function targetField(page) {
    return page.locator(CLOCK).getByLabel(TARGET_LABEL);
}

/** A button of the Clock panel.
 *
 * @param {import("playwright").Page} page - The surface.
 * @param {string} name - The button's name.
 * @returns {import("playwright").Locator} - The button.
 */
function clockButton(page, name) {
    return page.locator(CLOCK).getByRole("button", {name, exact: true});
}

/** The colour the elapsed time is drawn in.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {Promise<string>} - The computed colour.
 */
function elapsedColour(page) {
    return page.locator(ELAPSED).evaluate(element => getComputedStyle(element).color, null, WAIT);
}

Given("the clocks of this scenario's pages can be moved on", async function () {
    await this.context.clock.install();
    this.clocksInstalledAt = Date.now();
});

When("the clocks move on by {int} minute(s)", async function (minutes) {
    await moveClocksOn(/** @type {SoziWorld} */ (this), minutes * MINUTE_MS);
});

When("the clock's {string} button is pressed", async function (name) {
    await clockButton(this.presenter, name).click(WAIT);
});

When("the clock's target is set to {int} minute(s)", async function (minutes) {
    const field = targetField(this.presenter);
    await field.fill(String(minutes), WAIT);
    await field.press("Enter", WAIT);
});

When("the clock's target is cleared", async function () {
    const field = targetField(this.presenter);
    await field.fill("", WAIT);
    await field.press("Enter", WAIT);
});

When("{string} and Enter are typed into the clock's target field", async function (text) {
    const field = targetField(this.presenter);
    await field.pressSequentially(text, WAIT);
    await field.press("Enter", WAIT);
    await this.presenter.waitForTimeout(SETTLE_MS);
});

When("the {string} panel is shown", async function (title) {
    // Dockview hides a panel behind another tab; on a phone-width page every panel is a tab.
    await tabOf(this.presenter, title).click(WAIT);
});

Then("the clock shows the time of day", async function () {
    const page = this.presenter;
    await expect
        .poll(async () => {
            const text = await page.locator(TIME_OF_DAY).textContent(WAIT);
            const match = /(\d{1,2}):(\d{2})/.exec(text ?? "");
            if (!match) {
                return Infinity;
            }
            const shown = Number(match[1]) * 60 + Number(match[2]);
            const now = await page.evaluate(() => {
                const date = new Date();
                return date.getHours() * 60 + date.getMinutes();
            });
            // The page may read 12 or 24 hours, and midnight may fall between the two reads.
            const apart = Math.abs(shown - now) % HALF_DAY_MINUTES;
            return Math.min(apart, HALF_DAY_MINUTES - apart);
        })
        .toBeLessThanOrEqual(1);
});

Then("the elapsed time reads {string}", async function (text) {
    await expect(this.presenter.locator(ELAPSED)).toHaveText(text, WAIT);
});

Then("the elapsed time reads about {string}", async function (text) {
    await expectElapsedDrawn(this.presenter);
    const expected = secondsIn(text);
    const margin = aboutSeconds(/** @type {SoziWorld} */ (this));
    await expect
        .poll(async () => Math.abs((await elapsedSeconds(this.presenter)) - expected))
        .toBeLessThanOrEqual(margin);
});

Then("the clock's frame reads {string}", async function (text) {
    await expect(this.presenter.locator(FRAME)).toHaveText(text, WAIT);
});

Then("the clock's remaining time reads about {string}", async function (text) {
    const [duration, word] = text.split(" ");
    const expected = secondsIn(duration);
    const margin = aboutSeconds(/** @type {SoziWorld} */ (this));
    const remaining = this.presenter.locator(REMAINING);
    await expect(remaining).toContainText(word, WAIT);
    await expect
        .poll(async () => Math.abs(secondsIn(await remaining.textContent(WAIT)) - expected))
        .toBeLessThanOrEqual(margin);
});

Then("both surfaces read the same elapsed time, within a second", async function () {
    await expectElapsedDrawn(this.presenter);
    await expectElapsedDrawn(this.secondSurface);
    await expect
        .poll(async () => {
            const first = await elapsedSeconds(this.presenter);
            const second = await elapsedSeconds(this.secondSurface);
            // Two timers that never started agree too, and that is not what this is about.
            return first > 0 ? Math.abs(first - second) : Infinity;
        })
        .toBeLessThanOrEqual(SAME_TIME_SECONDS);
});

Then("the second surface's clock is paused", async function () {
    await expect(clockButton(this.secondSurface, "Start")).toBeEnabled(WAIT);
    await expectElapsedHolds(/** @type {SoziWorld} */ (this), this.secondSurface);
});

Then("the clock is in its normal colour", async function () {
    const elapsed = this.presenter.locator(ELAPSED);
    await expect(elapsed).toBeVisible(WAIT);
    await expect(elapsed).not.toHaveClass(NEAR);
    await expect(elapsed).not.toHaveClass(OVER);
    this.normalColour = await elapsedColour(this.presenter);
});

Then("the clock is in its near colour", async function () {
    const elapsed = this.presenter.locator(ELAPSED);
    await expect(elapsed).toHaveClass(NEAR, WAIT);
    await expect(elapsed).not.toHaveClass(OVER);
    this.nearColour = await elapsedColour(this.presenter);
    assert.notEqual(this.nearColour, this.normalColour, "the near colour is its own");
});

Then("the clock is in its over colour", async function () {
    const elapsed = this.presenter.locator(ELAPSED);
    await expect(elapsed).toHaveClass(OVER, WAIT);
    await expect(elapsed).not.toHaveClass(NEAR);
    const colour = await elapsedColour(this.presenter);
    assert.notEqual(colour, this.normalColour, "the over colour is not the normal one");
    assert.notEqual(colour, this.nearColour, "the over colour is not the near one");
});

Then("nothing in the clock panel is animated", async function () {
    const moving = await this.presenter.locator(CLOCK).evaluate(
        panel =>
            [panel, ...panel.querySelectorAll("*")]
                .filter(element => {
                    const {animationName, transitionDuration} = getComputedStyle(element);
                    return (
                        element.getAnimations().length > 0 ||
                        animationName !== "none" ||
                        transitionDuration.split(",").some(time => parseFloat(time) > 0)
                    );
                })
                .map(element => element.className),
        null,
        WAIT
    );
    assert.deepEqual(moving, []);
});

Then("the clock's target is {int} minute(s)", async function (minutes) {
    // On the display: the state a surface holds is what the display reported.
    await expect
        .poll(() =>
            this.presenter.evaluate(
                () => /** @type {any} */ (window).sozi.presenter.state.timer?.targetMs
            )
        )
        .toBe(minutes * MINUTE_MS);
    await expect(targetField(this.presenter)).toHaveValue(String(minutes), WAIT);
});

Then("the elapsed time is at least {int} pixels tall and fits its panel", async function (height) {
    assert.ok(height >= READABLE_PX, "the plan's smallest readable height");
    const elapsed = this.presenter.locator(ELAPSED);
    await expect(elapsed).toBeVisible(WAIT);
    const measured = await elapsed.evaluate(element => {
        const panel = /** @type {HTMLElement} */ (element.closest(".sozi-clock"));
        const range = document.createRange();
        range.selectNodeContents(element);
        const context = /** @type {CanvasRenderingContext2D} */ (
            document.createElement("canvas").getContext("2d")
        );
        context.font = getComputedStyle(element).font;
        const digit = context.measureText("0");
        const box = rect => rect.toJSON();
        return {
            digits: digit.actualBoundingBoxAscent + digit.actualBoundingBoxDescent,
            text: box(range.getBoundingClientRect()),
            panel: box(panel.getBoundingClientRect()),
            holder: box(/** @type {HTMLElement} */ (panel.parentElement).getBoundingClientRect())
        };
    });
    assert.ok(measured.digits >= height, `the digits are ${measured.digits} pixels tall`);
    for (const [inner, outer] of [
        [measured.text, measured.panel],
        [measured.panel, measured.holder]
    ]) {
        assert.ok(
            inner.left >= outer.left - TOLERANCE &&
                inner.top >= outer.top - TOLERANCE &&
                inner.right <= outer.right + TOLERANCE &&
                inner.bottom <= outer.bottom + TOLERANCE,
            `${JSON.stringify(inner)} does not fit in ${JSON.stringify(outer)}`
        );
    }
});

Then("the elapsed time stops changing", async function () {
    await expectElapsedHolds(/** @type {SoziWorld} */ (this), this.presenter);
});

Then("the clock's buttons are disabled", async function () {
    const buttons = this.presenter.locator(CLOCK).getByRole("button");
    await expect(buttons.first()).toBeDisabled(WAIT);
    for (const button of await buttons.all()) {
        await expect(button).toBeDisabled(WAIT);
    }
});
