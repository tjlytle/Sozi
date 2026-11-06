import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {frameOfTarget, matchFrames, nextToRender} from "../../../src/js/presenter/framePicker.js";

const frames = [
    {index: 0, id: "a", title: "Intro", notes: ""},
    {index: 1, id: "b", title: "Kubernetes", notes: ""},
    {index: 2, id: "c", title: "kubectl tricks", notes: ""},
    {index: 3, id: "d", title: "", notes: ""}
];

describe("framePicker", () => {
    test("matchFrames keeps the titles that hold the text, ignoring case", () => {
        const titles = query => matchFrames(frames, query).map(frame => frame.title);
        assert.deepEqual(titles("KUBER"), ["Kubernetes"]);
        assert.deepEqual(titles("kub"), ["Kubernetes", "kubectl tricks"]);
        assert.deepEqual(titles("tricks"), ["kubectl tricks"]);
    });

    test("matchFrames finds nothing when no title holds the text", () => {
        assert.deepEqual(matchFrames(frames, "zzz"), []);
    });

    test("an empty query keeps every frame, and so does one of spaces", () => {
        assert.deepEqual(matchFrames(frames, ""), frames);
        assert.deepEqual(matchFrames(frames, "   "), frames);
    });

    test("spaces around the query do not count", () => {
        assert.deepEqual(
            matchFrames(frames, " intro ").map(frame => frame.index),
            [0]
        );
    });

    test("frameOfTarget reads the tile an event happened on", () => {
        const tile = {dataset: {index: "7"}};
        assert.equal(frameOfTarget({closest: () => tile}), 7);
        assert.equal(frameOfTarget({closest: () => null}), null);
        assert.equal(frameOfTarget(null), null);
    });

    test("nextToRender takes a visible frame first", () => {
        assert.equal(nextToRender([0, 1, 2, 3], [2, 3]), 2);
    });

    test("nextToRender skips a visible frame that is not missing", () => {
        assert.equal(nextToRender([0, 3], [2, 3]), 3);
    });

    test("nextToRender takes the first missing frame when none is visible", () => {
        assert.equal(nextToRender([1, 2], []), 1);
        assert.equal(nextToRender([1, 2], [0]), 1);
    });

    test("nextToRender gives null when nothing is missing", () => {
        assert.equal(nextToRender([], [0, 1]), null);
    });
});
