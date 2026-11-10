/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The presenter workspace's saved layout: where it is stored, how it is written and read.
 *
 * A saved layout is the dock as dockview's `toJSON` gives it and the closed panels, which the
 * + menu lists. They are stored as `rail`, the name they had when a rail held them, so that
 * saved layouts and deck presets stay readable. The default layout is not stored: the
 * workspace builds it from each panel's position.
 *
 * @module
 */

/** The widest page, in CSS pixels, that shows the panels as one stack of tabs.
 *
 * @readonly
 * @default
 * @type {number}
 */
export const NARROW_MAX_WIDTH = 600;

/** The version of the saved layout's format; any other version is not read.
 *
 * @readonly
 * @default
 * @type {number}
 */
const LAYOUT_VERSION = 1;

/** The start of every layout's localStorage key; the page's path completes it.
 *
 * @readonly
 * @default
 * @type {string}
 */
const KEY_PREFIX = "sozi-presenter-layout:";

/**
 * A closed panel, and the dock group it was closed from.
 *
 * @typedef {object} ClosedEntry
 * @property {string} id - The panel's id.
 * @property {?string} group - The id of its group in the dock, null when it has none.
 */

/**
 * A layout as it is saved and read back.
 *
 * @typedef {object} SavedLayout
 * @property {any} dock - The dock, as dockview's `toJSON` gives it.
 * @property {ClosedEntry[]} rail - The closed panels, in the order they were closed.
 */

/**
 * A panel in a window of its own, which a saved layout docks again.
 *
 * @typedef {object} WindowEntry
 * @property {string} id - The panel's id.
 * @property {string} group - The id of the dock group it left.
 * @property {any} state - The panel as dockview's `toJSON` gave it in the dock.
 * @property {boolean} [active] - Was it the tab its group showed?
 */

/**
 * The localStorage key of a deck's layout.
 *
 * Every deck opened from a file shares one localStorage, so the path tells them apart. A
 * deck has two slots, wide and narrow, so that a phone's arrangement and a laptop's both last.
 *
 * @param {string} pathname - The presenter page's path, as `location.pathname` gives it.
 * @param {boolean} [narrow] - Is it the slot of a narrow page?
 * @returns {string} The key.
 */
export function layoutKey(pathname, narrow = false) {
    return KEY_PREFIX + (narrow ? "narrow:" : "") + pathname;
}

/**
 * Is a page this wide shown as one stack of tabs?
 *
 * @param {number} width - The page's width in CSS pixels.
 * @returns {boolean} True up to `NARROW_MAX_WIDTH` included.
 */
export function isNarrow(width) {
    return width <= NARROW_MAX_WIDTH;
}

/**
 * What a page shows, by precedence: what was saved here, then the deck's preset, then the
 * derived stack on a narrow page or the default layout on a wide one.
 *
 * @param {object} state - What this page has.
 * @param {boolean} state.narrow - Is the page narrow?
 * @param {boolean} state.saved - Is a layout saved for this width?
 * @param {boolean} state.preset - Does a preset of the deck suit this page?
 * @returns {"saved" | "preset" | "stack" | "default"} The source.
 */
export function layoutSource({narrow, saved, preset}) {
    if (saved) {
        return "saved";
    }
    if (preset) {
        return "preset";
    }
    return narrow ? "stack" : "default";
}

/**
 * A layout in its stored form.
 *
 * @param {any} dock - The dock, as dockview's `toJSON` gives it.
 * @param {ClosedEntry[]} rail - The closed panels.
 * @returns {{version: number, dock: any, rail: ClosedEntry[]}} The layout.
 */
export function layoutOf(dock, rail) {
    return {version: LAYOUT_VERSION, dock, rail};
}

/**
 * The text that saves a layout.
 *
 * @param {any} dock - The dock, as dockview's `toJSON` gives it.
 * @param {ClosedEntry[]} rail - The closed panels.
 * @returns {string} The text to store.
 */
export function savedLayoutText(dock, rail) {
    return JSON.stringify(layoutOf(dock, rail));
}

/**
 * Find a group in a grid, as dockview's `toJSON` writes it.
 *
 * @param {any} node - A branch or a leaf of the grid.
 * @param {string} id - The group's id.
 * @returns {any} The leaf's data, or undefined when the group is not there.
 */
function findGroup(node, id) {
    if (node.type === "leaf") {
        return node.data.id === id ? node.data : undefined;
    }
    return node.data.map(child => findGroup(child, id)).find(Boolean);
}

/**
 * A dock with the panels that are in windows of their own docked again.
 *
 * A panel goes back as the last tab of the group it left. When that group is gone, the panels
 * that left it go back together, in a group of their own at the end of the dock's outer row
 * (or column), showing the tab it showed. So a saved layout never needs a window to show it.
 *
 * @param {any} dock - The dock, as dockview's `toJSON` gives it; it is not changed.
 * @param {WindowEntry[]} windows - The panels in windows of their own.
 * @returns {any} The dock to save.
 */
export function dockedLayout(dock, windows) {
    if (!windows.length) {
        return dock;
    }
    const docked = structuredClone(dock);
    const {root} = docked.grid;
    for (const {id, group, state, active} of windows) {
        const leaf = findGroup(root, group);
        const gathered = findGroup(root, `window-${group}`);
        if (leaf) {
            leaf.views.push(id);
        } else if (gathered) {
            gathered.views.push(id);
            gathered.activeView = active ? id : gathered.activeView;
        } else {
            const sizes = root.data.map(child => child.size || 0);
            const size = sizes.reduce((sum, s) => sum + s, 0) / Math.max(sizes.length, 1);
            const data = {views: [id], activeView: id, id: `window-${group}`};
            root.data.push({type: "leaf", data, size});
        }
        docked.panels[id] = state;
    }
    return docked;
}

/**
 * Is it an object, and not null or an array?
 *
 * @param {any} v - The value.
 * @returns {boolean} True for a plain object.
 */
function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Read a closed panel's entry.
 *
 * @param {any} entry - The entry as stored.
 * @returns {?ClosedEntry} The entry, or null if a field is malformed.
 */
function readRailEntry(entry) {
    if (!isObject(entry) || typeof entry.id !== "string") {
        return null;
    }
    const {id, group} = entry;
    return typeof group === "string" || group === null ? {id, group} : null;
}

/**
 * Parse text as JSON.
 *
 * @param {string} text - The text.
 * @returns {any} Its value, or undefined if it is not JSON.
 */
function parsed(text) {
    try {
        return JSON.parse(text);
    } catch {
        // Text that is not JSON is a layout that cannot be read: the caller uses the default.
        return undefined;
    }
}

/**
 * Read a layout, from what this device saved or from a preset of the deck.
 *
 * It is refused when its version is not 1, when it names a panel that is not known, or when it
 * names one twice. A known panel it does not name is not a reason: the workspace adds it at its
 * default place, so a new panel costs nobody their layout.
 *
 * @param {any} data - The layout.
 * @param {string[]} knownIds - The id of every panel the workspace has.
 * @returns {?SavedLayout} The layout, or null when it cannot be used.
 */
export function readLayout(data, knownIds) {
    if (!isObject(data) || data.version !== LAYOUT_VERSION) {
        return null;
    }
    const {dock} = data;
    if (!isObject(dock) || !isObject(dock.grid) || !isObject(dock.panels)) {
        return null;
    }
    const rail = Array.isArray(data.rail) ? data.rail.map(readRailEntry) : [null];
    if (rail.includes(null)) {
        return null;
    }
    const ids = [...Object.keys(dock.panels), ...rail.map(entry => entry.id)];
    const usable = new Set(ids).size === ids.length && ids.every(id => knownIds.includes(id));
    return usable ? {dock, rail} : null;
}

/**
 * Read a saved layout from its text; text that is not JSON is refused.
 *
 * @param {string} text - The stored text.
 * @param {string[]} knownIds - The id of every panel the workspace has.
 * @returns {?SavedLayout} The layout, or null when it cannot be used.
 */
export function readSavedLayout(text, knownIds) {
    return readLayout(parsed(text), knownIds);
}
