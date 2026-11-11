/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Finding a presenter panel by its tab title, what it drew, and the layout the page saves for
// a deck: what the workspace steps and the steps of other panels share.

import {errors} from "playwright";
import {expect} from "playwright/test";

// What dockview-core draws. These four selectors are the only ones here that name the
// library, so a change of version or of engine changes them and nothing else.
export const TAB = ".dv-tab";
export const GROUP = ".dv-groupview";
export const SASH = ".dv-sash";
// The tinted area of a drop target: drawn in the group, or in an anchor over the dock when
// the theme mounts the overlays absolutely.
export const DROP_TARGET = ".dv-drop-target-selection, .dv-drop-target-anchor";

// The prefix of the localStorage key of a deck's layout; the page's path completes it. A deck
// may have more than one, one per width, each with this prefix and the path in its key.
export const LAYOUT_KEY = "sozi-presenter-layout:";

// A panel that is not there fails its step with this wait, not with the step's timeout.
export const WAIT = {timeout: 5000};

// One look inside a poll: short, so that a group that is not there yet leaves the poll time
// to look again.
const GLANCE = {timeout: 1000};

// The built-in panel the steps read by its own class.
const CONNECTION = ".sozi-connection";

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
export function groupOf(page, title) {
    return page.locator(GROUP).filter({has: tabOf(page, title)});
}

/** The titles of the tabs a person can see, sorted.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {Promise<string[]>} - The titles.
 */
export async function visibleTabTitles(page) {
    const titles = await page.locator(`${TAB}:visible`).allTextContents();
    return titles.map(title => title.trim()).sort();
}

/** The titles a step names in one comma-separated string, sorted.
 *
 * @param {string} list - The titles, separated by commas.
 * @returns {string[]} - The titles.
 */
export function titlesIn(list) {
    return list
        .split(",")
        .map(title => title.trim())
        .sort();
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
export async function savedAfter(page, action) {
    const before = await savedLayout(page);
    await action();
    await expect.poll(() => savedLayout(page)).not.toBe(before);
}

/** The box of the group that holds a panel's tab right now, for use inside a poll.
 *
 * A dock that is being rebuilt has no box for a moment. This returns null then, where
 * groupBox would throw, because a throw ends expect.poll instead of letting it look again.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The panel's title.
 * @returns {Promise<{x: number, y: number, width: number, height: number} | null>} - The
 *   box, or null when the group has none at this moment.
 */
export async function groupBoxNow(page, title) {
    try {
        return await groupOf(page, title).boundingBox(GLANCE);
    } catch (error) {
        if (error instanceof errors.TimeoutError) {
            return null;
        }
        throw error;
    }
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
export function contentOf(page, title) {
    return page.locator(title === "Connection" ? CONNECTION : `[data-addon-panel="${title}"]`);
}

/** The text of what the panels drew where a panel's group is, right now, for use in a poll.
 *
 * An add-on written as a person writes one, like the worked example of
 * docs/presenter-addons.md, draws no attribute for the steps to find. Its content is the
 * visible panel whose middle is inside the group of its tab.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The panel's title.
 * @returns {Promise<string>} - The text, or "" while the group has no box.
 */
export async function drawnTextNow(page, title) {
    const box = await groupBoxNow(page, title);
    if (!box) {
        return "";
    }
    return page.locator(".sozi-panel").evaluateAll(
        (panels, group) =>
            panels
                .filter(panel => {
                    const rect = panel.getBoundingClientRect();
                    const x = rect.x + rect.width / 2;
                    const y = rect.y + rect.height / 2;
                    return (
                        panel.checkVisibility({visibilityProperty: true}) &&
                        x >= group.x &&
                        x <= group.x + group.width &&
                        y >= group.y &&
                        y <= group.y + group.height
                    );
                })
                .map(panel => panel.textContent)
                .join("\n"),
        box
    );
}
