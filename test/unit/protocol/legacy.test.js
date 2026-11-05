import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {fromLegacy, legacyLoadedMessage} from "../../../src/js/protocol/legacy.js";
import {
    Roles,
    helloMessage,
    blankMessage,
    jumpToFrameMessage,
    nextMessage,
    previousMessage,
    previewMessage,
    followLinkMessage
} from "../../../src/js/protocol/messages.js";

const state = {frameCount: 5, blank: false, frameIds: ["f1", "f2", "f3", "f4", "f5"]};

describe("legacy messages", () => {
    test("each old navigation name maps to next, previous or jumpToFrame", () => {
        /** @type {Array<[string, object]>} */
        const cases = [
            ["moveToNext", nextMessage(true)],
            ["jumpToNext", nextMessage(false)],
            ["moveToPrevious", previousMessage(true)],
            ["jumpToPrevious", previousMessage(false)],
            ["moveToFirst", jumpToFrameMessage(0, true)],
            ["jumpToFirst", jumpToFrameMessage(0, false)],
            ["moveToLast", jumpToFrameMessage(4, true)],
            ["jumpToLast", jumpToFrameMessage(4, false)]
        ];
        for (const [name, expected] of cases) {
            assert.deepEqual(fromLegacy({name}, state), expected, name);
        }
    });

    test("jumpToFrame and moveToFrame take their index from args", () => {
        assert.deepEqual(
            fromLegacy({name: "jumpToFrame", args: [2]}, state),
            jumpToFrameMessage(2, false)
        );
        assert.deepEqual(
            fromLegacy({name: "moveToFrame", args: [3]}, state),
            jumpToFrameMessage(3, true)
        );
    });

    test("jumpToFrame and moveToFrame resolve a frame id to its index", () => {
        assert.deepEqual(
            fromLegacy({name: "jumpToFrame", args: ["f3"]}, state),
            jumpToFrameMessage(2, false)
        );
        assert.deepEqual(
            fromLegacy({name: "moveToFrame", args: ["f2"]}, state),
            jumpToFrameMessage(1, true)
        );
    });

    test("jumpToFrame without an index or id it can read is refused", () => {
        assert.equal(fromLegacy({name: "jumpToFrame"}, state), null);
        assert.equal(fromLegacy({name: "jumpToFrame", args: ["noSuchFrame"]}, state), null);
        assert.equal(fromLegacy({name: "jumpToFrame", args: [-1]}, state), null);
    });

    test("the blank screen names resolve against the current state", () => {
        assert.deepEqual(fromLegacy({name: "enableBlankScreen"}, state), blankMessage(true));
        assert.deepEqual(fromLegacy({name: "toggleBlankScreen"}, state), blankMessage(true));
        assert.deepEqual(
            fromLegacy({name: "toggleBlankScreen"}, {...state, blank: true}),
            blankMessage(false)
        );
    });

    test("the presenter's set-up names map to hello and preview", () => {
        assert.deepEqual(
            fromLegacy({name: "notifyOnFrameChange"}, state),
            helloMessage(Roles.surface)
        );
        assert.deepEqual(
            fromLegacy({name: "setPresenterMode", isCurrent: true}, state),
            previewMessage(true)
        );
        assert.deepEqual(
            fromLegacy({name: "setPresenterMode", isCurrent: false}, state),
            previewMessage(false)
        );
    });

    test("click maps to followLink", () => {
        assert.deepEqual(fromLegacy({name: "click", id: "a1"}, state), followLinkMessage("a1"));
        assert.equal(fromLegacy({name: "click"}, state), null);
    });

    test("loaded, unknown names and non-objects map to nothing", () => {
        for (const data of [{name: "loaded", length: 2}, {name: "noSuchMethod"}, null, "next"]) {
            assert.equal(fromLegacy(data, state), null, JSON.stringify(data));
        }
    });

    test("the loaded announcement carries the frame count", () => {
        assert.deepEqual(legacyLoadedMessage(2), {name: "loaded", length: 2});
    });
});
