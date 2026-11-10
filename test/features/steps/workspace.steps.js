/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the presenter workspace (#26, #318): finding a panel by its tab title, docking,
// resizing, the + menu, each panel's menu, maximise, pop out and the narrow stack.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {expect} from "playwright/test";

// What dockview-core draws. These four selectors are the only ones here that name the
// library, so a change of version or of engine changes them and nothing else.
const TAB = ".dv-tab";
const GROUP = ".dv-groupview";
const SASH = ".dv-sash";
// The tinted area of a drop target: drawn in the group, or in an anchor over the dock when
// the theme mounts the overlays absolutely.
const DROP_TARGET = ".dv-drop-target-selection, .dv-drop-target-anchor";

// What the workspace draws around dockview.
const WORKSPACE = ".sozi-workspace";
const CONNECTION = ".sozi-connection";

// The button that opens a menu, the bar's or a group header's (#318).
const MENU_BUTTON = '[aria-haspopup="menu"]';

// The accessible names of the bar's menu buttons (#318).
const ADD_PANEL = /Add panel/;
const LAYOUTS = /^Layouts/;

// Below this width the panels are one stack of tabs, and the stack saves nothing.
const NARROW = 600;

// The smallest side of a drop target a person can hit, in pixels.
const DROP_TARGET_SIDE = 48;

// The page the url panel of test/fixtures/addons points at.
const URL_PANEL_PAGE = "page.html";

// The prefix of the localStorage key of a deck's layout; the page's path completes it. A deck
// may have more than one, one per width, each with this prefix and the path in its key.
export const LAYOUT_KEY = "sozi-presenter-layout:";

// How far a width or an edge may be from the expected one, in pixels.
const TOLERANCE = 2;

// A panel that is not there fails its step with this wait, not with the step's timeout.
export const WAIT = {timeout: 5000};

/** The tab of a panel.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The panel's title.
 * @returns {import("playwright").Locator} - The tab with exactly this title.
 */
export function tabOf(page, title) {
    return page.locator(TAB).filter({hasText: new RegExp(`^\\s*${title}\\s*$`)});
}

/** The group that holds a panel's tab.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The panel's title.
 * @returns {import("playwright").Locator} - The group.
 */
function groupOf(page, title) {
    return page.locator(GROUP).filter({has: tabOf(page, title)});
}

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

/** The titles of the tabs a person can see, sorted.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {Promise<string[]>} - The titles.
 */
async function visibleTabTitles(page) {
    const titles = await page.locator(`${TAB}:visible`).allTextContents();
    return titles.map(title => title.trim()).sort();
}

/** The titles a step names in one comma-separated string, sorted.
 *
 * @param {string} list - The titles, separated by commas.
 * @returns {string[]} - The titles.
 */
function titlesIn(list) {
    return list
        .split(",")
        .map(title => title.trim())
        .sort();
}

/** What a panel drew.
 *
 * With `renderer: "always"` dockview keeps a panel's content in an overlay, away from its
 * tab, so a tab does not lead to its content: the Connection panel is found by its own
 * class, an add-on's by the attribute the test/fixtures/addons panels draw.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The panel's title.
 * @returns {import("playwright").Locator} - The content.
 */
function contentOf(page, title) {
    return page.locator(title === "Connection" ? CONNECTION : `[data-addon-panel="${title}"]`);
}

/** Every layout saved for the deck, whichever width it was saved at.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {Promise<?string>} - The stored texts as one string, or null when there is none.
 */
export function savedLayout(page) {
    return page.evaluate(prefix => {
        const keys = Object.keys(localStorage)
            .filter(key => key.startsWith(prefix) && key.includes(location.pathname))
            .sort();
        return keys.length ? keys.map(key => localStorage.getItem(key)).join("\n") : null;
    }, LAYOUT_KEY);
}

/** Do something that changes the layout, and wait until the change is saved.
 *
 * The page saves when the layout has settled. A reload that comes in the next step must
 * find what a person who paused for a moment would find.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {() => Promise<void>} action - What changes the layout.
 */
async function savedAfter(page, action) {
    const before = await savedLayout(page);
    await action();
    await expect.poll(() => savedLayout(page)).not.toBe(before);
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

/** The menu that is open: the last one, as a submenu opens after the menu it comes from.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {Promise<import("playwright").Locator>} - The menu.
 */
async function openMenu(page) {
    const menu = page.getByRole("menu").last();
    await expect(menu).toBeVisible(WAIT);
    return menu;
}

/** Open a menu of the bar on the workspace's left edge.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {RegExp} name - The accessible name of the bar's button.
 * @returns {Promise<import("playwright").Locator>} - The menu it opened.
 */
async function openBarMenu(page, name) {
    await page.getByRole("button", {name}).click(WAIT);
    return openMenu(page);
}

/** Open the ⋯ menu of a panel's group header, with that panel's tab active.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The panel's title.
 * @returns {Promise<import("playwright").Locator>} - The menu.
 */
async function openPanelMenu(page, title) {
    await tabOf(page, title).click(WAIT);
    await groupOf(page, title).locator(MENU_BUTTON).first().click(WAIT);
    return openMenu(page);
}

/** Choose an item of a panel's menu, then a panel from the submenu it opens.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The title of the panel whose menu it is.
 * @param {RegExp} item - The item's accessible name: Replace with… or Split right….
 * @param {string} other - The title of the panel to choose in the submenu.
 */
async function choosePanelFor(page, title, item, other) {
    const menu = await openPanelMenu(page, title);
    await menu.getByRole("menuitem", {name: item}).click(WAIT);
    // The panel menu's own items are actions, so a panel's title names one item only.
    await page.getByRole("menuitem", {name: other, exact: true}).click(WAIT);
}

/** Do something that changes the arrangement, and wait until it is saved if it is saved.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {() => Promise<void>} action - What changes the arrangement.
 */
async function arranged(page, action) {
    const narrow = (page.viewportSize()?.width ?? NARROW) < NARROW;
    await (narrow ? action() : savedAfter(page, action));
}

/** Close a panel from its menu.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The panel's title.
 */
async function closePanel(page, title) {
    await arranged(page, async () => {
        const menu = await openPanelMenu(page, title);
        await menu.getByRole("menuitem", {name: "Close", exact: true}).click(WAIT);
        await expect(tabOf(page, title)).toHaveCount(0);
    });
}

/** Check the items of the + menu, then close it.
 *
 * Each item's accessible name is its panel's title: the leading glyph is decoration and the
 * description is the item's accessible description.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string[]} titles - The titles the menu lists, and nothing else.
 */
async function expectAddMenu(page, titles) {
    const menu = await openBarMenu(page, ADD_PANEL);
    await expect(menu.getByRole("menuitem")).toHaveCount(titles.length);
    for (const title of titles) {
        await expect(menu.getByRole("menuitem", {name: title, exact: true})).toBeVisible();
    }
    await page.keyboard.press("Escape");
}

/** The window of a preview's iframe.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The panel's title: "Current", "Previous" or "Next".
 * @returns {Promise<import("playwright").Frame>} - The frame.
 */
async function previewFrame(page, title) {
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

When("the {string} panel is closed from its menu", async function (title) {
    await closePanel(this.presenter, title);
});

When("every panel but {string} is closed from its menu", async function (kept) {
    const titles = await visibleTabTitles(this.presenter);
    for (const title of titles.filter(title => title !== kept)) {
        await closePanel(this.presenter, title);
    }
});

When("{string} is added from the + menu", async function (title) {
    await arranged(this.presenter, async () => {
        const menu = await openBarMenu(this.presenter, ADD_PANEL);
        await menu.getByRole("menuitem", {name: title, exact: true}).click(WAIT);
        await expect(tabOf(this.presenter, title)).toHaveCount(1);
    });
});

When("{string} is split right of {string} from the panel menu", async function (title, target) {
    await arranged(this.presenter, () =>
        choosePanelFor(this.presenter, target, /^Split right/, title)
    );
});

When("{string} replaces {string} from the panel menu", async function (title, target) {
    await arranged(this.presenter, async () => {
        await choosePanelFor(this.presenter, target, /^Replace with/, title);
        await expect(tabOf(this.presenter, target)).toHaveCount(0);
    });
});

When("the layout {string} is chosen from the Layouts menu", async function (name) {
    await savedAfter(this.presenter, async () => {
        const menu = await openBarMenu(this.presenter, LAYOUTS);
        await menu.getByRole("menuitem", {name, exact: true}).click(WAIT);
    });
});

When("the {string} panel is maximised", async function (title) {
    // Chosen again it restores, and the menu then says so.
    const menu = await openPanelMenu(this.presenter, title);
    await menu.getByRole("menuitem", {name: /^(Maximise|Restore)$/}).click(WAIT);
});

When("the {string} panel is popped out from its menu", async function (title) {
    const menu = await openPanelMenu(this.presenter, title);
    const popup = this.presenter.waitForEvent("popup", WAIT);
    await menu.getByRole("menuitem", {name: "Pop out", exact: true}).click(WAIT);
    this.popout = await popup;
});

When("the popped-out window is closed", async function () {
    // Closed from inside, as a person closes it, so the page hears it go.
    const closed = this.popout.waitForEvent("close", WAIT);
    await this.popout.evaluate(() => setTimeout(() => window.close()));
    await closed;
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
    await expect(contentOf(this.presenter, title)).toContainText(text);
});

Then("the {string} panel's page reads {string}", async function (title, text) {
    await expect(tabOf(this.presenter, title)).toBeVisible();
    const body = this.presenter.frameLocator(`iframe[src$="${URL_PANEL_PAGE}"]`).locator("body");
    await expect(body).toContainText(text);
});

Then("the {string} panel is to the left of {string}", async function (title, other) {
    await expect
        .poll(async () => {
            const box = await groupOf(this.presenter, title).boundingBox(WAIT);
            const otherBox = await groupOf(this.presenter, other).boundingBox(WAIT);
            // A dock that is being rebuilt has no box for a moment: look again.
            return box && otherBox ? box.x + box.width - otherBox.x : Infinity;
        })
        .toBeLessThanOrEqual(TOLERANCE);
});

Then("the {string} panel is above {string}", async function (title, other) {
    await expect
        .poll(async () => {
            const box = await groupOf(this.presenter, title).boundingBox(WAIT);
            const otherBox = await groupOf(this.presenter, other).boundingBox(WAIT);
            // A dock that is being rebuilt has no box for a moment: look again.
            return box && otherBox ? box.y + box.height - otherBox.y : Infinity;
        })
        .toBeLessThanOrEqual(TOLERANCE);
});

Then("the {string} panel is {int} pixels wide", async function (title, width) {
    await expect
        .poll(async () => Math.abs((await groupBox(this.presenter, title)).width - width))
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

Then("the + menu lists {string}", async function (list) {
    await expectAddMenu(this.presenter, titlesIn(list));
});

Then("the + menu lists nothing", async function () {
    await expectAddMenu(this.presenter, []);
});

Then("the + menu lists {string} described as {string}", async function (title, description) {
    const menu = await openBarMenu(this.presenter, ADD_PANEL);
    const item = menu.getByRole("menuitem", {name: title, exact: true});
    await expect(item).toHaveAccessibleDescription(description);
    await this.presenter.keyboard.press("Escape");
});

Then("{string} is disabled in the {string} panel's menu", async function (name, title) {
    const menu = await openPanelMenu(this.presenter, title);
    await expect(menu.getByRole("menuitem", {name, exact: true})).toBeDisabled();
    await this.presenter.keyboard.press("Escape");
});

Then("the {string} panel is in a window of its own", async function (title) {
    await expect(tabOf(this.popout, title)).toBeVisible(WAIT);
    await expect(tabOf(this.presenter, title)).toBeHidden();
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

Then("the {string} preview shows frame {string}", async function (title, frameTitle) {
    const frame = await previewFrame(this.presenter, title);
    await expect
        .poll(() => frame.evaluate(() => window.sozi?.player?.currentFrame?.title))
        .toBe(frameTitle);
    await expect(this.presenter.locator(previewSelector(title))).toBeVisible();
});
