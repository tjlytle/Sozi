/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the Frames panel (#30): finding a tile by its title, jumping, the mark, the
// thumbnails and the deck that renders them, the notes, the filter and a long scroll.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {expect} from "playwright/test";
import {buildDeck, builtDeck} from "../support/world.js";
import {installFakeTransport} from "./addons.steps.js";
import {scriptsAndHandlers} from "./notes.steps.js";
import {LAYOUT_KEY, WAIT, tabOf} from "./workspace.steps.js";

// What the panel draws. A tile is a button, and aria-current on it is the mark. The filter
// is the panel's one input.
const PICKER = ".sozi-frame-picker";
const TILE = `button${PICKER}__tile`;
const TILE_TITLE = `${PICKER}__title`;
const PICKER_NOTES = `${PICKER}__notes`;
const MARKED_TILE = `${TILE}[aria-current]:not([aria-current="false"])`;

// A layout saved by the build just before the panel existed, with a panel resized so that the
// page had something to save.
const LAYOUT_BEFORE_THE_PANEL = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "fixtures",
    "layout-before-frames.json"
);

// Rendering a deck's thumbnails takes a while on a busy machine.
const THUMBNAILS_WAIT = {timeout: 15000};

// One run of the CLI, which starts Electron.
const CLI_STEP = {timeout: 120000};

// A press held this long is a long press: the plan's 500 ms and a margin.
const LONG_PRESS_MS = 600;

// The fixtures' transitions take 1000 ms, so a frame reached sooner had none.
const SOONER_THAN_A_TRANSITION = {timeout: 700};

// How long a move that should not happen has to show, in milliseconds.
const SETTLE_MS = 300;

// How long the dock has to finish choosing a tab, in milliseconds.
const TAB_SETTLE_MS = 100;

// How far the panel's edges may be from the page's, in pixels.
const TOLERANCE = 2;

// One turn of the wheel, and how many it may take to reach the end of a 100-frame grid.
const WHEEL_PIXELS = 300;
const WHEEL_TURNS = 300;

// The class of the three preview iframes, which were there before the picker.
const PREVIEW = /sozi-(current|previous|next)-frame/;

/** The tile of a frame.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The frame's title.
 * @returns {import("playwright").Locator} - The tile with exactly this title.
 */
function tileOf(page, title) {
    const titleElement = page.locator(TILE_TITLE, {hasText: new RegExp(`^\\s*${title}\\s*$`)});
    return page.locator(TILE).filter({has: titleElement});
}

/** Bring the Frames panel to the front: by default it is a tab behind Notes.
 *
 * @param {import("playwright").Page} page - The presenter page.
 */
async function showPicker(page) {
    await tabOf(page, "Frames").click(WAIT);
    // The dock finishes choosing the tab a moment after the click and takes the focus then, so
    // a focus given sooner is lost.
    await page.waitForTimeout(TAB_SETTLE_MS);
}

/** The picker's filter, clicked into as a person does.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {Promise<import("playwright").Locator>} - The input, with the focus.
 */
async function pickerFilter(page) {
    await showPicker(page);
    const filter = page.locator(`${PICKER} input`);
    await filter.click(WAIT);
    await expect(filter).toBeFocused(WAIT);
    return filter;
}

/** How many tiles have no thumbnail drawn yet.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {Promise<number>} - The number of tiles.
 */
function tilesWithoutThumbnail(page) {
    return page.locator(TILE).evaluateAll(
        tiles =>
            tiles.filter(tile => {
                const image = tile.querySelector("img");
                return !(image?.complete && image.naturalWidth > 0);
            }).length
    );
}

/** The iframes the presenter page has added since it loaded, except the previews.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {Promise<number>} - How many there were, counting those it has removed again.
 */
async function addedDecks(page) {
    const classes = await page.evaluate(() =>
        [.../** @type {any} */ (window).addedIframes].map(iframe => iframe.className)
    );
    return classes.filter(name => !PREVIEW.test(name)).length;
}

Given("the presenter page is on a touch screen", async function () {
    await this.openPresenterOnTouchScreen(this.fixture);
    await this.presenterIsReady();
});

Given("a second surface is attached to the audience window", async function () {
    await this.audience.waitForFunction(() => Boolean(/** @type {any} */ (window).sozi?.display));
    await this.audience.evaluate(installFakeTransport);
    await this.audience.evaluate(() => {
        const {sozi, fakeTransport} = /** @type {any} */ (window);
        sozi.display.registerTransport(fakeTransport);
    });
});

Given("the audience window does not answer", async function () {
    // A capture listener on the window runs first, so the display never hears the page.
    await this.audience.evaluate(() => {
        window.addEventListener("message", event => event.stopImmediatePropagation(), true);
    });
});

Given("the saved layout for the deck has no {string} panel", async function (title) {
    const text = fs.readFileSync(LAYOUT_BEFORE_THE_PANEL, "utf8");
    const panels = Object.values(JSON.parse(text).dock.panels);
    assert.ok(!panels.some(panel => panel.title === title), `the fixture has no "${title}"`);
    await this.presenter.evaluate(
        ([prefix, value]) => localStorage.setItem(prefix + location.pathname, value),
        [LAYOUT_KEY, text]
    );
});

When("the frame {string} is tapped in the picker", async function (title) {
    await tileOf(this.presenter, title).tap(WAIT);
});

When("the frame {string} is clicked in the picker", async function (title) {
    await showPicker(this.presenter);
    await tileOf(this.presenter, title).click(WAIT);
});

When("the frame {string} is clicked in the picker with Shift", async function (title) {
    await showPicker(this.presenter);
    await tileOf(this.presenter, title).click({...WAIT, modifiers: ["Shift"]});
});

When("the frame {string} is focused in the picker", async function (title) {
    await showPicker(this.presenter);
    const tile = tileOf(this.presenter, title);
    await tile.focus(WAIT);
    await expect(tile).toBeFocused(WAIT);
});

When("the frame {string} is hovered in the picker", async function (title) {
    await showPicker(this.presenter);
    await tileOf(this.presenter, title).hover(WAIT);
});

When("the frame {string} is long pressed in the picker", async function (title) {
    await showPicker(this.presenter);
    const tile = tileOf(this.presenter, title);
    await tile.scrollIntoViewIfNeeded(WAIT);
    const box = await tile.boundingBox(WAIT);
    assert.ok(box, `the tile of "${title}" is visible`);
    const point = {x: box.x + box.width / 2, y: box.y + box.height / 2};
    // A real touch, held: Playwright's own touchscreen only taps.
    const cdp = await this.context.newCDPSession(this.presenter);
    await cdp.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [point]});
    await sleep(LONG_PRESS_MS);
    await cdp.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
});

When("{string} is typed in the picker's filter", async function (text) {
    const filter = await pickerFilter(this.presenter);
    await filter.pressSequentially(text, WAIT);
});

When("the key {string} is pressed in the picker's filter", async function (key) {
    const filter = await pickerFilter(this.presenter);
    await filter.press(key, WAIT);
});

When("the deck is rebuilt", CLI_STEP, function () {
    const deck = builtDeck(this.fixture);
    const before = fs.statSync(deck.html).mtimeMs;
    buildDeck(deck);
    assert.notEqual(fs.statSync(deck.html).mtimeMs, before, "the build rewrote the page");
});

When("the picker is scrolled from top to bottom", async function () {
    const page = this.presenter;
    await showPicker(page);
    const first = page.locator(TILE).first();
    await first.hover(WAIT);
    // Every gap between two frames the page draws, for as long as the wheel turns.
    await page.evaluate(() => {
        const timer = {longest: 0, running: true};
        /** @type {any} */ (window).frameTimer = timer;
        let last = performance.now();
        const tick = now => {
            timer.longest = Math.max(timer.longest, now - last);
            last = now;
            if (timer.running) {
                requestAnimationFrame(tick);
            }
        };
        requestAnimationFrame(tick);
    });
    const distanceLeft = () =>
        first.evaluate(tile => {
            let scroller = /** @type {Element} */ (tile.parentElement);
            while (
                scroller.parentElement &&
                !/auto|scroll/.test(getComputedStyle(scroller).overflowY)
            ) {
                scroller = scroller.parentElement;
            }
            return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
        });
    assert.ok((await distanceLeft()) > 0, "the grid is longer than the panel");
    let turns = 0;
    while ((await distanceLeft()) > 1 && turns < WHEEL_TURNS) {
        await page.mouse.wheel(0, WHEEL_PIXELS);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        turns++;
    }
    assert.ok((await distanceLeft()) <= 1, `the grid reached its end in ${turns} turns`);
    this.longestFrameMs = await page.evaluate(() => {
        const timer = /** @type {any} */ (window).frameTimer;
        timer.running = false;
        return timer.longest;
    });
});

Then("the second surface heard the frame {string}", async function (title) {
    await expect
        .poll(() =>
            this.audience.evaluate(
                frameTitle =>
                    /** @type {any} */ (window).fakeTransport.sent.some(
                        message => message.name === "frameChange" && message.title === frameTitle
                    ),
                title
            )
        )
        .toBe(true);
});

Then("the picker marks the frame {string}", async function (title) {
    await expect(this.presenter.locator(`${MARKED_TILE} ${TILE_TITLE}`)).toHaveText([title], WAIT);
});

Then('the "Frames" panel fills the page below its tabs', async function () {
    const page = this.presenter;
    await expect(async () => {
        const panel = await page.locator(PICKER).boundingBox(WAIT);
        const tab = await tabOf(page, "Frames").boundingBox(WAIT);
        const size = page.viewportSize();
        assert.ok(panel && tab && size, "the panel and its tab are visible");
        const near = (actual, expected, name) =>
            assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${name} is ${actual}`);
        near(panel.x, 0, "the left edge");
        near(panel.width, size.width, "the width");
        near(panel.y, tab.y + tab.height, "the top edge");
        near(panel.y + panel.height, size.height, "the bottom edge");
    }).toPass(WAIT);
});

Then("the audience window stays on frame {string}", async function (title) {
    await sleep(SETTLE_MS);
    const current = await this.audience.evaluate(() => window.sozi.player.currentFrame.title);
    assert.equal(current, title);
});

Then("the audience window is on frame {string} with no transition running", async function (title) {
    await expect
        .poll(
            () =>
                this.audience.evaluate(() => {
                    const {player} = window.sozi;
                    return {title: player.currentFrame.title, running: player.animator.running};
                }),
            SOONER_THAN_A_TRANSITION
        )
        .toEqual({title, running: false});
});

Then("every tile in the picker has a thumbnail", async function () {
    const page = this.presenter;
    await showPicker(page);
    await expect(page.locator(TILE).first()).toBeAttached(WAIT);
    await expect.poll(() => tilesWithoutThumbnail(page), THUMBNAILS_WAIT).toBe(0);
});

Then("the thumbnails of {string} and {string} differ", async function (first, second) {
    const source = title => tileOf(this.presenter, title).locator("img").getAttribute("src", WAIT);
    assert.notEqual(await source(first), await source(second));
});

Then("no thumbnail deck was loaded", async function () {
    assert.equal(await addedDecks(this.presenter), 0);
});

Then("a thumbnail deck was loaded", async function () {
    await showPicker(this.presenter);
    await expect.poll(() => addedDecks(this.presenter)).toBeGreaterThan(0);
});

Then("the picker's notes show {string}", async function (text) {
    const notes = this.presenter.locator(PICKER_NOTES);
    await expect(notes).toBeVisible(WAIT);
    await expect(notes).toContainText(text, WAIT);
});

Then("the picker's notes hold no script and no event handler attribute", async function () {
    assert.deepEqual(await scriptsAndHandlers(this.presenter.locator(PICKER_NOTES)), []);
});

Then("the picker shows only the frame {string}", async function (title) {
    const titles = this.presenter.locator(`${TILE}:visible ${TILE_TITLE}`);
    await expect(titles).toHaveText([title], WAIT);
});

Then("the picker shows {int} frames", async function (count) {
    await expect(this.presenter.locator(`${TILE}:visible`)).toHaveCount(count, WAIT);
});

Then("the picker says {string}", async function (text) {
    await expect(this.presenter.locator(PICKER)).toContainText(text, WAIT);
});

Then("the frame {string} is in view in the picker", async function (title) {
    await expect(tileOf(this.presenter, title)).toBeInViewport(WAIT);
});

Then("no frame took longer than {int} ms", function (limit) {
    assert.ok(this.longestFrameMs <= limit, `the longest frame took ${this.longestFrameMs} ms`);
});

Then("the picker added at most one iframe", async function () {
    assert.ok((await addedDecks(this.presenter)) <= 1);
});
