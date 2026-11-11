/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Finding a presenter panel by its tab title, and the layout the page saves for a deck: what
// the workspace steps and the steps of other panels share.

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
