/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {builtDeck, copyDeck, removeDecks} from "../../features/support/decks.js";

test("a fixture is built once and its pages are shared", () => {
    const deck = builtDeck("basic");
    assert.equal(builtDeck("basic"), deck);
    assert.ok(fs.existsSync(deck.html), deck.html);
    assert.ok(fs.existsSync(deck.presenter), deck.presenter);
    removeDecks();
});

test("every copy of a fixture is a folder of its own", () => {
    const first = copyDeck("basic");
    const second = copyDeck("basic");
    assert.notEqual(first.dir, second.dir);
    removeDecks();
});

test("removing the decks deletes every build and copy, and empties the cache", () => {
    const deck = builtDeck("basic");
    const copy = copyDeck("basic");
    removeDecks();
    assert.ok(!fs.existsSync(deck.dir), deck.dir);
    assert.ok(!fs.existsSync(copy.dir), copy.dir);
    assert.doesNotThrow(() => removeDecks());

    const rebuilt = builtDeck("basic");
    assert.notEqual(rebuilt, deck);
    assert.ok(fs.existsSync(rebuilt.html), rebuilt.html);
    removeDecks();
});
