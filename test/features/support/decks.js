/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The decks scenarios open: fixtures copied and built once by the real CLI and shared, the
// copies a scenario changes for itself, and their removal at the end of the run.

import fs from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const {runSozi, withTempDeck} = require("../../cli/helpers.js");

/** A built deck: where its files and pages are, and the function that removes them.
 *
 * @typedef {{dir: string, svg: string, html: string, presenter: string, cleanup: Function}} BuiltDeck
 */

/** @type {Map<string, BuiltDeck>} */
const decks = new Map();
/** The decks scenarios copied for themselves, to remove at the end of the run.
 *
 * @type {{cleanup: Function}[]}
 */
const copies = [];

/** Build a deck with the CLI.
 *
 * @param {{dir: string, svg: string, cleanup: Function}} deck - A deck `withTempDeck` copied.
 * @returns {BuiltDeck} - Where the built pages are.
 */
export function buildDeck(deck) {
    const run = runSozi(["build", path.basename(deck.svg)], {cwd: deck.dir});
    if (run.code !== 0) {
        throw new Error(`sozi build ${deck.svg} failed:\n${run.stdout}\n${run.stderr}`);
    }
    const base = deck.svg.replace(/\.svg$/, "");
    return {
        dir: deck.dir,
        svg: deck.svg,
        html: base + ".sozi.html",
        presenter: base + "-presenter.sozi.html",
        cleanup: deck.cleanup
    };
}

/** The built deck for a fixture, building it with the CLI on first use.
 *
 * @param {string} name - The fixture name under test/fixtures.
 * @returns {BuiltDeck} - Where the built pages are.
 */
export function builtDeck(name) {
    if (!decks.has(name)) {
        decks.set(name, buildDeck(withTempDeck(name)));
    }
    // Cast: the deck was built above if it was missing.
    return /** @type {BuiltDeck} */ (decks.get(name));
}

/** Remove the notes file of a built deck and build it again, in place.
 *
 * The deck's pages stay where they are, for the page already open on them. A later scenario
 * that asks for this fixture gets a fresh copy, with its notes file.
 *
 * @param {string} name - The fixture name.
 */
export function rebuildWithoutNotesFile(name) {
    const deck = builtDeck(name);
    fs.rmSync(path.join(deck.dir, `${name}.notes.md`));
    buildDeck(deck);
    decks.delete(name);
    decks.set(`${name} without its notes file`, deck);
}

/** Keep a deck a step built under a name, so that `builtDeck(name)` and the steps that open
 * `this.fixture` find it.
 *
 * @param {string} name - The name the scenario gives the deck.
 * @param {BuiltDeck} deck - The built deck.
 */
export function registerBuiltDeck(name, deck) {
    decks.set(name, deck);
}

/** A copy of a fixture for one scenario that changes it; built decks are shared.
 *
 * @param {string} name - The fixture name under test/fixtures.
 * @returns {{dir: string, svg: string, json: string, cleanup: Function}} - The copy.
 */
export function copyDeck(name) {
    const deck = withTempDeck(name);
    copies.push(deck);
    return deck;
}

/** Remove every deck the run built or copied. */
export function removeDecks() {
    for (const deck of [...decks.values(), ...copies]) {
        deck.cleanup();
    }
}
