/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** What the workspace's menus offer: the panels to add, to put in a panel's place or beside
 * it, and the layouts to choose.
 *
 * @module
 */

import {readLayout} from "./layout.js";
import {matches} from "./presets.js";

/** @typedef {import("./Workspace.js").PanelSpec} PanelSpec */
/** @typedef {import("./layout.js").SavedLayout} SavedLayout */
/** @typedef {import("../protocol/layoutPresets.js").LayoutPreset} LayoutPreset */

/**
 * A panel as a menu lists it.
 *
 * @typedef {object} PanelChoice
 * @property {string} id - The panel's id.
 * @property {string} title - Its title, the item's name.
 * @property {string} icon - The glyph before the title.
 * @property {string} description - One line that says what it is; empty when it has none.
 */

/**
 * A layout the Layouts menu offers.
 *
 * @typedef {object} PresetChoice
 * @property {string} name - The preset's name, or `Default`.
 * @property {?SavedLayout} layout - The preset's layout, read; null for Default.
 */

/** The name of the layout the panels build by themselves.
 *
 * @readonly
 * @default
 * @type {string}
 */
export const DEFAULT_LAYOUT = "Default";

/**
 * A panel as a menu lists it.
 *
 * @param {PanelSpec} spec - The panel.
 * @returns {PanelChoice} The item.
 */
function choiceOf({id, title, icon, description = ""}) {
    return {id, title, icon, description};
}

/**
 * The + menu's items: every panel that is not showing.
 *
 * @param {PanelSpec[]} panels - Every panel, in the order they were registered.
 * @param {string[]} showingIds - The panels that are showing.
 * @returns {PanelChoice[]} The panels to add, in the order they were registered.
 */
export function closedItems(panels, showingIds) {
    return panels.filter(({id}) => !showingIds.includes(id)).map(choiceOf);
}

/**
 * What Replace with and Split offer in a panel's menu: every other panel.
 *
 * @param {PanelSpec[]} panels - Every panel, in the order they were registered.
 * @param {string} selfId - The panel whose menu it is.
 * @returns {PanelChoice[]} The other panels.
 */
export function panelChoices(panels, selfId) {
    return panels.filter(({id}) => id !== selfId).map(choiceOf);
}

/**
 * The Layouts menu's items: the deck's presets for a page this wide that it can read, in the
 * deck's order, then Default.
 *
 * @param {Record<string, LayoutPreset>} presets - The deck's presets.
 * @param {number} width - The page's width in CSS pixels.
 * @param {string[]} knownIds - The id of every panel the workspace has.
 * @returns {PresetChoice[]} The layouts.
 */
export function presetChoices(presets, width, knownIds) {
    /** @type {PresetChoice[]} */
    const choices = [];
    for (const [name, {match, layout}] of Object.entries(presets)) {
        const read = matches(match, width) ? readLayout(layout, knownIds) : null;
        if (read) {
            choices.push({name, layout: read});
        }
    }
    return [...choices, {name: DEFAULT_LAYOUT, layout: null}];
}
