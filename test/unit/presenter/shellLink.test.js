import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {readShellLink} from "../../../src/js/presenter/shellLink.js";

const DECK = "https://talks.example/my/deck.sozi.html";

/** The fragment of a pairing link.
 *
 * @param {Record<string, string>} fields - Its fields.
 * @returns {string} - The fragment, with its "#".
 */
function hash(fields) {
    return `#${new URLSearchParams(fields)}`;
}

describe("readShellLink", () => {
    test("reads the deck and the session", () => {
        assert.deepEqual(readShellLink(hash({deck: DECK, session: "s1"})), {
            deck: DECK,
            session: "s1",
            params: {}
        });
    });

    test("keeps every other field for the add-on", () => {
        const link = readShellLink(hash({deck: DECK, session: "s1", key: "k+/=", relay: "eu"}));
        assert.deepEqual(link?.params, {key: "k+/=", relay: "eu"});
    });

    test("takes an http: deck as well as an https: one", () => {
        const deck = "http://127.0.0.1:8080/deck.sozi.html";
        assert.equal(readShellLink(hash({deck, session: "s1"}))?.deck, deck);
    });

    test("an empty fragment is no link at all", () => {
        assert.equal(readShellLink(""), null);
        assert.equal(readShellLink("#"), null);
    });

    for (const deck of [
        "javascript:alert(1)",
        "data:text/html,<p>hello</p>",
        "file:///home/tim/deck.sozi.html",
        "deck.sozi.html",
        "/talks/deck.sozi.html",
        ""
    ]) {
        test(`refuses the deck "${deck}"`, () => {
            assert.throws(() => readShellLink(hash({deck, session: "s1"})), TypeError);
        });
    }

    test("refuses a link with no deck", () => {
        assert.throws(() => readShellLink(hash({session: "s1"})), TypeError);
    });

    test("refuses a link with no session", () => {
        assert.throws(() => readShellLink(hash({deck: DECK})), TypeError);
        assert.throws(() => readShellLink(hash({deck: DECK, session: ""})), TypeError);
    });
});
