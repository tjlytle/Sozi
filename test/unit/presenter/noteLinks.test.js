import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {linkTarget} from "../../../src/js/presenter/noteLinks.js";

describe("linkTarget", () => {
    const frames = [
        {index: 0, id: "frame1", title: "One", notes: ""},
        {index: 1, id: "2", title: "Two", notes: ""},
        {index: 2, id: "the end", title: "Three", notes: ""}
    ];

    test("a frame id is a link to that frame", () => {
        assert.deepEqual(linkTarget("#frame1", frames), {kind: "frame", index: 0});
    });

    test("a frame number is a link to that frame, from 1", () => {
        assert.deepEqual(linkTarget("#3", frames), {kind: "frame", index: 2});
    });

    test("an id that looks like a number wins over the number", () => {
        assert.deepEqual(linkTarget("#2", frames), {kind: "frame", index: 1});
    });

    test("a percent-encoded id is decoded", () => {
        assert.deepEqual(linkTarget("#the%20end", frames), {kind: "frame", index: 2});
    });

    test("frame 0 is broken", () => {
        assert.deepEqual(linkTarget("#0", frames), {kind: "broken", fragment: "0"});
    });

    test("a number past the last frame is broken", () => {
        assert.deepEqual(linkTarget("#4", frames), {kind: "broken", fragment: "4"});
    });

    test("a number with letters after it is broken", () => {
        assert.deepEqual(linkTarget("#3abc", frames), {kind: "broken", fragment: "3abc"});
    });

    test("an unknown id is broken", () => {
        assert.deepEqual(linkTarget("#nowhere", frames), {kind: "broken", fragment: "nowhere"});
    });

    test("# alone is broken", () => {
        assert.deepEqual(linkTarget("#", frames), {kind: "broken", fragment: ""});
    });

    test("a bad percent escape is broken, kept as written", () => {
        assert.deepEqual(linkTarget("#%E0", frames), {kind: "broken", fragment: "%E0"});
    });

    test("an https address is external", () => {
        assert.deepEqual(linkTarget("https://example.org", frames), {kind: "external"});
    });

    test("a relative path is external", () => {
        assert.deepEqual(linkTarget("other.html#frame1", frames), {kind: "external"});
    });

    test("a mailto address is external", () => {
        assert.deepEqual(linkTarget("mailto:a@example.org", frames), {kind: "external"});
    });
});
