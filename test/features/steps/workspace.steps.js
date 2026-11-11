/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the presenter workspace (#26, #318, #302): docking, resizing, the drop targets,
// maximise and the narrow stack. The menus that arrange it are in workspace-menus.steps.js;
// finding a panel by its tab title is in support/panels.js.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {expect} from "playwright/test";
import {builtDeck} from "../support/decks.js";
import {
    DROP_TARGET,
    GROUP,
    LAYOUT_KEY,
    SASH,
    TAB,
    WAIT,
    contentOf,
    drawnTextNow,
    groupBoxNow,
    groupOf,
    savedAfter,
    tabOf,
    titlesIn,
    visibleTabTitles
} from "../support/panels.js";

// What the workspace draws around dockview.
export const WORKSPACE = ".sozi-workspace";

// The smallest side of a drop target a person can hit, in pixels.
const DROP_TARGET_SIDE = 48;

// The page the url panel of test/fixtures/addons points at.
const URL_PANEL_PAGE = "page.html";

// How far a width or an edge may be from the expected one, in pixels.
const TOLERANCE = 2;

/** The box of the group that holds a panel's tab.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The panel's title.
 * @returns {Promise<{x: number, y: number, width: number, height: number}>} - The box.
 */
async function groupBox(page, title) {
    const box = await groupOf(page, title).boundingBox(WAIT);
    assert.ok(box, `the group of "${title}" is visible`);
    return box;
}

/** How far one panel's group reaches past another's, measured inside a poll.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The first panel's title.
 * @param {string} other - The second panel's title.
 * @param {(box: {x: number, y: number, width: number, height: number},
 *   otherBox: {x: number, y: number, width: number, height: number}) => number} overlap -
 *   The overlap of the two boxes.
 * @returns {Promise<number>} - The overlap, or Infinity while either group has no box.
 */
async function overlapNow(page, title, other, overlap) {
    const box = await groupBoxNow(page, title);
    const otherBox = await groupBoxNow(page, other);
    // A dock that is being rebuilt has no box for a moment: look again.
    return box && otherBox ? overlap(box, otherBox) : Infinity;
}

/** Drag from one point to another with the mouse, as a person does.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {{x: number, y: number}} from - Where the button goes down.
 * @param {{x: number, y: number}} to - Where it comes up.
 */
async function drag(page, from, to) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // The first small move starts the drag, the last one lets the target see where it ends.
    await page.mouse.move(from.x + 5, from.y + 5);
    await page.mouse.move(to.x, to.y, {steps: 5});
    await page.mouse.move(to.x, to.y);
    await page.mouse.up();
}

/** The middle of a box.
 *
 * @param {{x: number, y: number, width: number, height: number}} box - The box.
 * @returns {{x: number, y: number}} - Its middle.
 */
function middleOf(box) {
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

/** The splitter on the right or the left edge of a box, the right one if there are both.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {{x: number, width: number}} box - The box.
 * @returns {Promise<{x: number, onRight: boolean}>} - Where the splitter is along the
 *     width, and whether it is on the box's right edge.
 */
async function splitterBeside(page, box) {
    const boxes = await page
        .locator(`${SASH}:visible`)
        .evaluateAll(sashes => sashes.map(sash => sash.getBoundingClientRect().toJSON()));
    const centres = boxes
        .filter(sash => sash.height > sash.width)
        .map(sash => sash.x + sash.width / 2);
    const near = edge => centres.find(centre => Math.abs(centre - edge) <= 8);
    const right = near(box.x + box.width);
    const left = near(box.x);
    assert.ok(right !== undefined || left !== undefined, "the panel has a splitter beside it");
    return right !== undefined ? {x: right, onRight: true} : {x: left, onRight: false};
}

/** The window of a preview's iframe.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The panel's title: "Current", "Previous" or "Next".
 * @returns {Promise<import("playwright").Frame>} - The frame.
 */
export async function previewFrame(page, title) {
    const iframe = await page.locator(previewSelector(title)).elementHandle(WAIT);
    const frame = await iframe?.contentFrame();
    assert.ok(frame, `the "${title}" preview has a window`);
    return frame;
}

/** The selector of a preview's iframe.
 *
 * @param {string} title - The panel's title: "Current", "Previous" or "Next".
 * @returns {string} - The selector.
 */
function previewSelector(title) {
    return `.sozi-${title.toLowerCase()}-frame`;
}

Given("the saved layout for the deck is {string}", async function (text) {
    await this.presenter.evaluate(
        ([prefix, value]) => localStorage.setItem(prefix + location.pathname, value),
        [LAYOUT_KEY, text]
    );
});

When("the {string} panel is dragged to the left of {string}", async function (title, target) {
    const tab = await tabOf(this.presenter, title).boundingBox(WAIT);
    assert.ok(tab, `the tab of "${title}" is visible`);
    const box = await groupBox(this.presenter, target);
    // A tenth of the way in is inside the drop zone of the target's left edge.
    const onLeftEdge = {x: box.x + box.width / 10, y: box.y + box.height / 2};
    await savedAfter(this.presenter, () => drag(this.presenter, middleOf(tab), onLeftEdge));
});

When("the {string} panel is resized to {int} pixels wide", async function (title, width) {
    const box = await groupBox(this.presenter, title);
    const splitter = await splitterBeside(this.presenter, box);
    const change = width - box.width;
    const y = box.y + box.height / 2;
    await savedAfter(this.presenter, () =>
        drag(
            this.presenter,
            {x: splitter.x, y},
            {x: splitter.onRight ? splitter.x + change : splitter.x - change, y}
        )
    );
});

When("a drag of the {string} tab starts over {string}", async function (title, target) {
    const tab = await tabOf(this.presenter, title).boundingBox(WAIT);
    assert.ok(tab, `the tab of "${title}" is visible`);
    const from = middleOf(tab);
    const to = middleOf(await groupBox(this.presenter, target));
    await this.presenter.mouse.move(from.x, from.y);
    await this.presenter.mouse.down();
    // The button stays down: the drop targets show only while the drag goes on.
    await this.presenter.mouse.move(from.x + 5, from.y + 5);
    await this.presenter.mouse.move(to.x, to.y, {steps: 5});
});

When("the layout is reset", async function () {
    const button = this.presenter.getByRole("button", {name: "Reset layout"});
    await savedAfter(this.presenter, () => button.click(WAIT));
});

When("the {string} preview is clicked", async function (title) {
    const frame = await previewFrame(this.presenter, title);
    // The preview takes the key only once the presenter has made it a preview.
    await frame.waitForFunction(
        () => window.sozi?.presentation?.enableKeyboardNavigation === false,
        undefined,
        WAIT
    );
    const iframe = this.presenter.locator(previewSelector(title));
    await iframe.click(WAIT);
    await expect(iframe).toBeFocused();
});

When("the {string} tab is chosen", async function (title) {
    await tabOf(this.presenter, title).click(WAIT);
});

When("the {string} button in the {string} panel is pressed", async function (name, title) {
    // Dockview hides a tab that is behind another one, its buttons with it.
    await tabOf(this.presenter, title).click(WAIT);
    await contentOf(this.presenter, title).getByRole("button", {name}).click(WAIT);
});

When("the {string} panel is scrolled into view", async function (title) {
    // What the notes do to a section when they follow the talk.
    await contentOf(this.presenter, title).evaluate(
        element => element.scrollIntoView({block: "start"}),
        null,
        WAIT
    );
});

When("the audience window is closed", async function () {
    await this.audience.close();
});

Then("the workspace shows the panels {string}", async function (list) {
    await expect.poll(() => visibleTabTitles(this.presenter)).toEqual(titlesIn(list));
});

Then("the workspace shows a panel {string}", async function (title) {
    await expect(tabOf(this.presenter, title)).toBeVisible();
});

Then("the workspace does not show a panel {string}", async function (title) {
    await expect(tabOf(this.presenter, title)).toBeHidden();
});

Then("the {string} panel reads {string}", async function (title, text) {
    await expect(tabOf(this.presenter, title)).toBeVisible();
    const content = contentOf(this.presenter, title);
    if ((await content.count()) === 0) {
        // Only the front tab of a group is drawn: a person brings the panel to the front first.
        await tabOf(this.presenter, title).click();
        await expect.poll(() => drawnTextNow(this.presenter, title), WAIT).toContain(text);
        return;
    }
    await expect(content).toContainText(text);
});

Then("the {string} panel's page reads {string}", async function (title, text) {
    await expect(tabOf(this.presenter, title)).toBeVisible();
    const body = this.presenter.frameLocator(`iframe[src$="${URL_PANEL_PAGE}"]`).locator("body");
    await expect(body).toContainText(text);
});

Then("the {string} panel is to the left of {string}", async function (title, other) {
    await expect
        .poll(() =>
            overlapNow(
                this.presenter,
                title,
                other,
                (box, otherBox) => box.x + box.width - otherBox.x
            )
        )
        .toBeLessThanOrEqual(TOLERANCE);
});

Then("the {string} panel is above {string}", async function (title, other) {
    await expect
        .poll(() =>
            overlapNow(
                this.presenter,
                title,
                other,
                (box, otherBox) => box.y + box.height - otherBox.y
            )
        )
        .toBeLessThanOrEqual(TOLERANCE);
});

Then("the {string} panel is {int} pixels wide", async function (title, width) {
    await expect
        .poll(async () => {
            const box = await groupBoxNow(this.presenter, title);
            return box ? Math.abs(box.width - width) : Infinity;
        })
        .toBeLessThanOrEqual(TOLERANCE);
});

Then("the {string} panel fills the workspace", async function (title) {
    const box = await groupBox(this.presenter, title);
    const workspace = await this.presenter.locator(WORKSPACE).boundingBox(WAIT);
    assert.ok(workspace, "the workspace is visible");
    // The bar on the left edge is not the dock's: the group fills the rest, to the right edge.
    const right = workspace.x + workspace.width;
    assert.ok(box.x + box.width >= right - TOLERANCE, `right edge ${box.x + box.width}`);
    assert.ok(box.height >= workspace.height - TOLERANCE, `height ${box.height}`);
    await expect.poll(() => visibleTabTitles(this.presenter)).toEqual([title]);
});

Then("the drop targets are visible", async function () {
    const target = this.presenter.locator(DROP_TARGET).locator("visible=true").first();
    await expect(target).toBeVisible(WAIT);
    const look = await target.evaluate(element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
            outlined:
                (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
                (style.borderTopStyle !== "none" && parseFloat(style.borderTopWidth) > 0),
            tinted: !/^(transparent|rgba\(.*, 0\))$/.test(style.backgroundColor),
            side: Math.min(rect.width, rect.height)
        };
    });
    assert.ok(look.outlined, "the drop target has an outline");
    assert.ok(look.tinted, "the drop target is tinted");
    assert.ok(look.side >= DROP_TARGET_SIDE, `the drop target is ${look.side} pixels across`);
});

Then("the panels are tabs {string}", async function (list) {
    const groups = this.presenter.locator(`${GROUP}:visible`);
    await expect(groups).toHaveCount(1);
    // A tab that does not fit may be scrolled away; it is still a tab of the stack.
    await expect
        .poll(async () => {
            const titles = await groups.locator(TAB).allTextContents();
            return titles.map(title => title.trim()).sort();
        })
        .toEqual(titlesIn(list));
});

When("the presenter page is opened on a phone at {int} by {int}", async function (width, height) {
    // A phone lays a page out at the width its viewport line asks for, or at 980 pixels
    // without one; a desktop window resized to a phone's size does neither, so only
    // `isMobile` shows what a phone shows.
    await this.openPresenterIn(
        {viewport: {width, height}, isMobile: true, hasTouch: true},
        builtDeck(this.fixture)
    );
    await this.presenterIsReady();
});

Then("the presenter page is laid out {int} pixels wide", async function (width) {
    const laidOut = await this.presenter.evaluate(() => window.innerWidth);
    assert.equal(laidOut, width, `the presenter page is laid out ${laidOut} pixels wide`);
});

Then("the {string} preview shows frame {string}", async function (title, frameTitle) {
    const frame = await previewFrame(this.presenter, title);
    await expect
        .poll(() => frame.evaluate(() => window.sozi?.player?.currentFrame?.title))
        .toBe(frameTitle);
    await expect(this.presenter.locator(previewSelector(title))).toBeVisible();
});
