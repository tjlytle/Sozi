/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Unit tests of the presentation file naming helper. They load the module
// directly, without Electron.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {presentationFiles, replaceFileExtWith, svgOfPresentation, svgKeyOf, isPresentationFile, presentationDataError} = require(path.resolve(__dirname, "..", "..", "src", "js", "naming.js"));

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

    test("a presentation that does not end in .sozi.json: outputs from its base name", () => {
        assert.deepEqual(presentationFiles("/decks/talk.svg", "/decks/talk.json"), {
            svg:          "/decks/talk.svg",
            presentation: "/decks/talk.json",
            html:         "/decks/talk.sozi.html",
            presenter:    "/decks/talk-presenter.sozi.html"
        });
    });

    test("the .sozi.json suffix is matched in any letter case", () => {
        const files = presentationFiles("/decks/talk.svg", "/decks/Talk-ES.SOZI.JSON");
        assert.equal(files.html, "/decks/Talk-ES.sozi.html");
        assert.equal(files.presenter, "/decks/Talk-ES-presenter.sozi.html");
    });
});

describe("svgOfPresentation", () => {
    test("without an svg key: <base>.svg beside the presentation", () => {
        assert.equal(svgOfPresentation("/decks/talk.sozi.json"), "/decks/talk.svg");
        assert.equal(svgOfPresentation("/decks/talk.sozi.json", ""), "/decks/talk.svg");
        assert.equal(svgOfPresentation("/decks/my.talk.SOZI.JSON"), "/decks/my.talk.svg");
        assert.equal(svgOfPresentation("/decks/talk.json"), "/decks/talk.svg");
    });

    test("bare names stay bare", () => {
        assert.equal(svgOfPresentation("talk.sozi.json"), "talk.svg");
        assert.equal(svgOfPresentation("talk-es.sozi.json", "talk.svg"), "talk.svg");
    });

    test("an svg key is relative to the directory of the presentation", () => {
        assert.equal(svgOfPresentation("/decks/talk-es.sozi.json", "talk.svg"), "/decks/talk.svg");
        assert.equal(svgOfPresentation("/decks/es/spanish.sozi.json", "../talk.svg"), "/decks/talk.svg");
        assert.equal(svgOfPresentation("/decks/es/spanish.sozi.json", "/art/talk.svg"), "/art/talk.svg");
    });
});

describe("svgKeyOf", () => {
    test("empty when the SVG is the default for the presentation", () => {
        assert.equal(svgKeyOf("/decks/talk.svg", "/decks/talk.sozi.json"), "");
        assert.equal(svgKeyOf("talk.svg", "talk.sozi.json"), "");
    });

    test("a path relative to the directory of the presentation, with forward slashes", () => {
        assert.equal(svgKeyOf("/decks/talk.svg", "/decks/talk-es.sozi.json"), "talk.svg");
        assert.equal(svgKeyOf("/decks/talk.svg", "/decks/es/spanish.sozi.json"), "../talk.svg");
        assert.equal(svgKeyOf("/decks/art/talk.svg", "/decks/talk.sozi.json"), "art/talk.svg");
    });

    test("round trip with svgOfPresentation", () => {
        for (const [svg, presentation] of [
            ["/decks/talk.svg", "/decks/talk.sozi.json"],
            ["/decks/talk.svg", "/decks/es/spanish.sozi.json"],
            ["/decks/art/talk.svg", "/decks/talk-es.sozi.json"]
        ]) {
            assert.equal(svgOfPresentation(presentation, svgKeyOf(svg, presentation)), svg);
        }
    });
});

describe("isPresentationFile", () => {
    test("only a name ending in .sozi.json, in any letter case", () => {
        assert.equal(isPresentationFile("/decks/talk.sozi.json"), true);
        assert.equal(isPresentationFile("TALK.SOZI.JSON"), true);
        assert.equal(isPresentationFile("/decks/chart.json"), false);
        assert.equal(isPresentationFile("/decks/talk.svg"), false);
        assert.equal(isPresentationFile("sozi.json"), false);
    });
});

describe("presentationDataError", () => {
    test("null for presentation data", () => {
        assert.equal(presentationDataError(JSON.stringify({frames: []})), null);
        assert.equal(presentationDataError(JSON.stringify({svg: "a.svg", frames: [{}]})), null);
    });

    test("a reason for unparsable text or data without a frames array", () => {
        assert.match(presentationDataError("{ not json"), /.+/);
        assert.equal(presentationDataError("{}"), "no \"frames\" array");
        assert.equal(presentationDataError(JSON.stringify({frames: {}})), "no \"frames\" array");
        assert.equal(presentationDataError("null"), "no \"frames\" array");
        assert.equal(presentationDataError("[1, 2]"), "no \"frames\" array");
    });
});
