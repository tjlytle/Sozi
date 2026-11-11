/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The worked example of a guide under docs/, read from its code blocks, so that a scenario
// runs the code the guide shows and not a copy of it (#415).

import fs from "node:fs";
import path from "node:path";

// The block whose keys go into the deck's presentation file rather than beside it.
const PRESENTATION = "deck.sozi.json";

// A fenced block: its info string (a language, then a file name) and its text.
const FENCE = /^```(\S*)[ \t]+(\S+)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;

/** A guide's worked example: the files it saves beside the deck and the keys it adds to the
 * deck's presentation file.
 *
 * @typedef {{files: Record<string, string>, presentation: object}} DocExample
 */

/** The worked example in a guide's markdown, from the fenced blocks whose info string names
 * a file after the language ("js frame-count.js"); a block with no file name is skipped.
 *
 * @param {string} markdown - The guide.
 * @returns {DocExample} - The files by name, and the parsed `deck.sozi.json` block.
 */
export function exampleFiles(markdown) {
    /** @type {Record<string, string>} */
    const files = {};
    let presentation = {};
    for (const [, , name, text] of markdown.matchAll(FENCE)) {
        if (name === PRESENTATION) {
            try {
                presentation = JSON.parse(text);
            } catch (error) {
                throw new Error(`the ${PRESENTATION} block is not JSON: ${error.message}`, {
                    cause: error
                });
            }
        } else {
            files[name] = text;
        }
    }
    return {files, presentation};
}

/** Save a worked example into a copied deck: its files beside the deck, its keys into the
 * deck's presentation file.
 *
 * @param {{dir: string, json: string}} deck - A deck `copyDeck` copied.
 * @param {DocExample} example - What `exampleFiles` read.
 */
export function applyExample(deck, example) {
    for (const [name, text] of Object.entries(example.files)) {
        fs.writeFileSync(path.join(deck.dir, name), text);
    }
    const presentation = JSON.parse(fs.readFileSync(deck.json, "utf8"));
    fs.writeFileSync(
        deck.json,
        JSON.stringify({...presentation, ...example.presentation}, null, 2)
    );
}
