/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for arranging the presenter workspace without dragging (#318): the + menu and the
// Layouts menu of the bar on the left edge, and the ⋯ menu of each group header.

import {Then, When} from "@cucumber/cucumber";
import {expect} from "playwright/test";
import {WAIT, groupOf, savedAfter, tabOf, titlesIn, visibleTabTitles} from "./workspace.steps.js";

// The button that opens a menu, the bar's or a group header's.
const MENU_BUTTON = '[aria-haspopup="menu"]';

// The accessible names of the bar's menu buttons.
const ADD_PANEL = /Add panel/;
const LAYOUTS = /^Layouts/;

// Below this width the panels are one stack of tabs, and the stack saves nothing.
const NARROW = 600;

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
