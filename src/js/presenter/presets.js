/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Choosing a deck's layout preset for a page, and writing one to a file.
 *
 * @module
 */

import {isNarrow, readLayout} from "./layout.js";

/** @typedef {import("../protocol/layoutPresets.js").LayoutPreset} LayoutPreset */
/** @typedef {import("../protocol/layoutPresets.js").PresetLayout} PresetLayout */
/** @typedef {import("../protocol/layoutPresets.js").PresetMatch} PresetMatch */
/** @typedef {import("./layout.js").SavedLayout} SavedLayout */

/**
 * A word the shell takes as one, whatever the deck is called.
 *
 * @param {string} word - The word.
 * @returns {string} The word, quoted if it needs to be.
 */
function shellWord(word) {
    return /^[\w./=-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/**
 * Is a preset for a page this wide?
 *
 * @param {PresetMatch} match - Which pages the preset is for.
 * @param {number} width - The page's width in CSS pixels.
 * @returns {boolean} True if it is.
 */
export function matches(match, width) {
    switch (match) {
        case "phone":
            return isNarrow(width);
        case "laptop":
            return !isNarrow(width);
        default:
            return width >= match.minWidth;
    }
}

/**
 * The width class of a page, which the preset form starts on.
 *
 * @param {number} width - The page's width in CSS pixels.
 * @returns {"phone" | "laptop"} The class.
 */
export function matchForWidth(width) {
    return isNarrow(width) ? "phone" : "laptop";
}

/**
 * Choose a preset for a page: the first in the deck's order that matches and can be used.
 *
 * A preset that matches but names an unknown panel or another version is refused, and the
 * search goes on.
 *
 * @param {Record<string, LayoutPreset>} presets - The deck's presets, in order.
 * @param {number} width - The page's width in CSS pixels.
 * @param {string[]} knownIds - The id of every panel this surface has.
 * @param {string[]} [failed] - The presets the caller tried and could not show: skipped, and
 *   not listed as refused.
 * @returns {{name: ?string, layout: ?SavedLayout, refused: string[]}} The chosen preset, null
 *   if there is none, and the names of the ones refused on the way.
 */
export function pickPreset(presets, width, knownIds, failed = []) {
    /** @type {string[]} */
    const refused = [];
    for (const [name, {match, layout}] of Object.entries(presets)) {
        if (matches(match, width) && !failed.includes(name)) {
            const usable = readLayout(layout, knownIds);
            if (usable) {
                return {name, layout: usable, refused};
            }
            refused.push(name);
        }
    }
    return {name: null, layout: null, refused};
}

/**
 * The name of the file a preset is saved in.
 *
 * @param {string} deckId - The deck's file name without `.sozi.html`.
 * @param {string} name - The preset's name.
 * @returns {string} The file's name.
 */
export function presetFileName(deckId, name) {
    return `${deckId}.${name}.layout.json`;
}

/**
 * The content of the file a preset is saved in, which `sozi --cli set --layout` reads.
 *
 * @param {PresetMatch} match - Which pages the preset is for.
 * @param {PresetLayout} layout - The layout.
 * @returns {string} The text.
 */
export function presetFileText(match, layout) {
    return JSON.stringify({match, layout}, null, 2) + "\n";
}

/**
 * The command that puts a saved preset in its deck.
 *
 * @param {string} deckId - The deck's file name without `.sozi.html`.
 * @param {string} name - The preset's name.
 * @param {string} fileName - The name of the file it was saved in.
 * @returns {string} The command.
 */
export function setCommand(deckId, name, fileName) {
    const deck = shellWord(`${deckId}.sozi.json`);
    return `sozi --cli set ${deck} --layout ${shellWord(`${name}=${fileName}`)}`;
}
