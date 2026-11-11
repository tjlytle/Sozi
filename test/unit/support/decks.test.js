/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test} from "node:test";
import assert from "node:assert/strict";
import {builtDeck, registerBuiltDeck} from "../../features/support/decks.js";

test("a deck registered under a name is the built deck for that name", () => {
    const deck = {
        dir: "/tmp/deck",
        svg: "/tmp/deck/basic.svg",
        html: "/tmp/deck/basic.sozi.html",
        presenter: "/tmp/deck/basic-presenter.sozi.html",
        cleanup: () => {}
    };
    registerBuiltDeck("basic with the worked example", deck);
    assert.equal(builtDeck("basic with the worked example"), deck);
});
