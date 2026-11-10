import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_FONT_SIZE,
    coveringSection,
    nextFontSize,
    notesUrl,
    readFontSize
} from "../../../src/js/presenter/notesPosition.js";

describe("coveringSection", () => {
    const sections = [{index: 1}, {index: 3}, {index: 5}];

    test("a frame before every section has none", () => {
        assert.equal(coveringSection(sections, 0), null);
    });

    test("a frame with a section is covered by its own", () => {
        assert.equal(coveringSection(sections, 3), sections[1]);
    });

    test("a frame between sections is covered by the one before it", () => {
        assert.equal(coveringSection(sections, 4), sections[1]);
    });

    test("a frame after every section is covered by the last", () => {
        assert.equal(coveringSection(sections, 9), sections[2]);
    });

    test("no sections cover nothing", () => {
        assert.equal(coveringSection([], 2), null);
    });
});

describe("readFontSize", () => {
    test("reads a stored size", () => {
        assert.equal(readFontSize("20"), 20);
    });

    test("bad stored text gives the default", () => {
        for (const text of [null, "", "big", "12.5", "-3", "NaN"]) {
            assert.equal(readFontSize(text), DEFAULT_FONT_SIZE, String(text));
        }
    });

    test("a stored size out of bounds comes back in bounds", () => {
        assert.equal(readFontSize("4"), 12);
        assert.equal(readFontSize("400"), 32);
    });
});

describe("nextFontSize", () => {
    test("moves by the step", () => {
        assert.equal(nextFontSize(16, 2), 18);
        assert.equal(nextFontSize(16, -2), 14);
    });

    test("stops at 12 and 32", () => {
        assert.equal(nextFontSize(12, -2), 12);
        assert.equal(nextFontSize(32, 2), 32);
    });
});

describe("notesUrl", () => {
    test("is null for a deck on file:", () => {
        assert.equal(notesUrl("file:///talks/deck.sozi.html"), null);
    });

    test("sits beside a deck on http: or https:", () => {
        assert.equal(
            notesUrl("http://localhost:8000/talks/deck.sozi.html"),
            "http://localhost:8000/talks/deck.notes.md"
        );
        assert.equal(
            notesUrl("https://example.org/deck.sozi.html"),
            "https://example.org/deck.notes.md"
        );
    });

    test("drops the query and the frame in the address", () => {
        assert.equal(
            notesUrl("https://example.org/deck.sozi.html?x=1#frame6"),
            "https://example.org/deck.notes.md"
        );
    });

    test("is null for a page that is not a deck", () => {
        assert.equal(notesUrl("https://example.org/index.html"), null);
    });

    test("is null for what is not an address", () => {
        assert.equal(notesUrl("deck.sozi.html"), null);
    });
});
