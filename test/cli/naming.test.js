/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Unit tests of the presentation file naming helper. They load the module
// directly, without Electron.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {presentationFiles, replaceFileExtWith} = require(path.resolve(__dirname, "..", "..", "src", "js", "naming.js"));

describe("replaceFileExtWith", () => {
    test("replaces the last extension", () => {
        assert.equal(replaceFileExtWith("/a/talk.svg", ".sozi.json"), "/a/talk.sozi.json");
        assert.equal(replaceFileExtWith("/a/my.talk.svg", ".sozi.html"), "/a/my.talk.sozi.html");
    });

    test("ignores dots in directory names", () => {
        assert.equal(replaceFileExtWith("/a.b/talk", ".sozi.json"), "/a.b/talk");
    });
});

describe("presentationFiles", () => {
    test("default: every file beside the SVG, named after it", () => {
        assert.deepEqual(presentationFiles("/decks/talk.svg"), {
            svg:          "/decks/talk.svg",
            presentation: "/decks/talk.sozi.json",
            html:         "/decks/talk.sozi.html",
            presenter:    "/decks/talk-presenter.sozi.html"
        });
    });

    test("default: names with several dots keep today's names", () => {
        assert.deepEqual(presentationFiles("/decks/v1.2/my.talk.svg"), {
            svg:          "/decks/v1.2/my.talk.svg",
            presentation: "/decks/v1.2/my.talk.sozi.json",
            html:         "/decks/v1.2/my.talk.sozi.html",
            presenter:    "/decks/v1.2/my.talk-presenter.sozi.html"
        });
    });

    test("default: bare file names stay bare (backend name and location)", () => {
        assert.deepEqual(presentationFiles("talk.svg"), {
            svg:          "talk.svg",
            presentation: "talk.sozi.json",
            html:         "talk.sozi.html",
            presenter:    "talk-presenter.sozi.html"
        });
    });

    test("an undefined or null presentation means the default", () => {
        assert.deepEqual(presentationFiles("/decks/talk.svg", undefined), presentationFiles("/decks/talk.svg"));
        assert.deepEqual(presentationFiles("/decks/talk.svg", null), presentationFiles("/decks/talk.svg"));
    });

    test("explicit presentation beside the SVG: outputs follow the presentation", () => {
        assert.deepEqual(presentationFiles("/decks/talk.svg", "/decks/talk-es.sozi.json"), {
            svg:          "/decks/talk.svg",
            presentation: "/decks/talk-es.sozi.json",
            html:         "/decks/talk-es.sozi.html",
            presenter:    "/decks/talk-es-presenter.sozi.html"
        });
    });

    test("explicit presentation in another directory: outputs beside it", () => {
        assert.deepEqual(presentationFiles("/decks/talk.svg", "/decks/es/spanish.sozi.json"), {
            svg:          "/decks/talk.svg",
            presentation: "/decks/es/spanish.sozi.json",
            html:         "/decks/es/spanish.sozi.html",
            presenter:    "/decks/es/spanish-presenter.sozi.html"
        });
    });
});
