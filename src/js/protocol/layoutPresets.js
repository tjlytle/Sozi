/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The named layouts a deck carries for the presenter: their names and their shape.
 *
 * They live here because the deck and the surfaces may share nothing else (standard 2.3).
 * docs/presenter-protocol.md describes the shape.
 *
 * @module
 */

/**
 * Which pages a preset is for: `phone` is up to 600 pixels wide, `laptop` wider than that,
 * `minWidth` at least so many pixels.
 *
 * @typedef {"phone" | "laptop" | {minWidth: number}} PresetMatch
 */

/**
 * A layout as a deck carries it: the dock as dockview's `toJSON` gives it, and the rail.
 *
 * @typedef {object} PresetLayout
 * @property {number} version - The version of the saved layout's format.
 * @property {any} dock - The dock.
 * @property {{id: string, group: ?string}[]} rail - The panels on the rail, in order.
 */

/**
 * A preset: a layout, and the pages it is for.
 *
 * @typedef {object} LayoutPreset
 * @property {PresetMatch} match - Which pages it is for.
 * @property {PresetLayout} layout - The layout.
 */

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
 * Read which pages a preset is for.
 *
 * @param {any} match - The field as stored.
 * @returns {?PresetMatch} The match, or null if it is malformed.
 */
function readMatch(match) {
    if (match === "phone" || match === "laptop") {
        return match;
    }
    const valid = isObject(match) && Number.isFinite(match.minWidth) && match.minWidth >= 0;
    return valid ? {minWidth: match.minWidth} : null;
}

/**
 * Is it a panel on the rail, as a preset stores it?
 *
 * @param {any} entry - The entry as stored.
 * @returns {boolean} True when its fields are well formed.
 */
function isRailEntry(entry) {
    return (
        isObject(entry) &&
        typeof entry.id === "string" &&
        (typeof entry.group === "string" || entry.group === null)
    );
}

/**
 * Read a preset's layout.
 *
 * A version this code does not know is still a layout: the surface decides what it can use.
 *
 * @param {any} layout - The field as stored.
 * @returns {?PresetLayout} The layout, or null if it is malformed.
 */
function readPresetLayout(layout) {
    if (!isObject(layout) || !Number.isInteger(layout.version)) {
        return null;
    }
    const {version, dock, rail} = layout;
    const valid =
        isObject(dock) &&
        isObject(dock.grid) &&
        isObject(dock.panels) &&
        Array.isArray(rail) &&
        rail.every(isRailEntry);
    return valid ? {version, dock, rail} : null;
}

/**
 * Can a preset have this name?
 *
 * It starts with a letter: a numeric key would jump to the front of a JSON object and break
 * the file order that decides which preset wins.
 *
 * @param {any} name - The name.
 * @returns {boolean} True for a usable name.
 */
export function isPresetName(name) {
    return typeof name === "string" && /^[A-Za-z][\w-]*$/.test(name);
}

/**
 * Read a preset.
 *
 * @param {any} value - The preset as stored.
 * @returns {?LayoutPreset} The preset with only its own fields, or null if it is malformed.
 */
export function readPreset(value) {
    if (!isObject(value)) {
        return null;
    }
    const match = readMatch(value.match);
    const layout = readPresetLayout(value.layout);
    return match && layout ? {match, layout} : null;
}

/**
 * Read a deck's presets, keeping the valid ones in order.
 *
 * @param {any} value - The presets as stored, by name.
 * @returns {{presets: Record<string, LayoutPreset>, ignored: string[]}} The valid presets, and
 *   the names of the others.
 */
export function readPresets(value) {
    /** @type {Record<string, LayoutPreset>} */
    const presets = {};
    /** @type {string[]} */
    const ignored = [];
    for (const [name, entry] of isObject(value) ? Object.entries(value) : []) {
        const preset = isPresetName(name) ? readPreset(entry) : null;
        if (preset) {
            presets[name] = preset;
        } else {
            ignored.push(name);
        }
    }
    return {presets, ignored};
}
