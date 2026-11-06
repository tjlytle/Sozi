/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The presenter workspace's saved layout: where it is stored, how it is written and read.
 *
 * A saved layout is the dock as dockview's `toJSON` gives it and the panels on the rail.
 * The default layout is not stored: the workspace builds it from each panel's position.
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
 * A panel on the rail, and the dock group it was minimised from.
 *
 * @typedef {object} RailEntry
 * @property {string} id - The panel's id.
 * @property {?string} group - The id of its group in the dock, null when it has none.
 */

/**
 * A layout as it is saved and read back.
 *
 * @typedef {object} SavedLayout
 * @property {any} dock - The dock, as dockview's `toJSON` gives it.
 * @property {RailEntry[]} rail - The panels on the rail, in order.
 */

/**
 * The localStorage key of a deck's layout.
 *
 * Every deck opened from a file shares one localStorage, so the path tells them apart.
 *
 * @param {string} pathname - The presenter page's path, as `location.pathname` gives it.
 * @returns {string} The key.
 */
export function layoutKey(pathname) {
    return KEY_PREFIX + pathname;
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
 * The text that saves a layout.
 *
 * @param {any} dock - The dock, as dockview's `toJSON` gives it.
 * @param {RailEntry[]} rail - The panels on the rail.
 * @returns {string} The text to store.
 */
export function savedLayoutText(dock, rail) {
    return JSON.stringify({version: LAYOUT_VERSION, dock, rail});
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
 * Read a rail entry.
 *
 * @param {any} entry - The entry as stored.
 * @returns {?RailEntry} The entry, or null if a field is malformed.
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
 * Read a saved layout.
 *
 * It is refused when the text is not JSON, its version is not 1, or its panels are not
 * exactly the known ones, each either docked or on the rail.
 *
 * @param {string} text - The stored text.
 * @param {string[]} knownIds - The id of every panel the workspace has.
 * @returns {?SavedLayout} The layout, or null when it cannot be used.
 */
export function readSavedLayout(text, knownIds) {
    const data = parsed(text);
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
    const exact = ids.length === knownIds.length && knownIds.every(id => ids.includes(id));
    return exact ? {dock, rail} : null;
}
