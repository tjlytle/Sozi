import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    MessageNames,
    Roles,
    helloMessage,
    frameChangeMessage,
    blankMessage,
    jumpToFrameMessage,
    nextMessage,
    previousMessage,
    customMessage,
    previewMessage,
    followLinkMessage,
    keyMessage,
    readMessage,
    deckIdOf
} from "../../../src/js/protocol/messages.js";
import {viewportMessage} from "../../../src/js/protocol/viewport.js";

const frame = {index: 1, id: "frame2", title: "Two", notes: "<p>Second</p>"};
const viewport = {width: 1200, height: 400, pixelRatio: 2};
const frames = [{index: 0, id: "frame1", title: "One", notes: ""}, frame];
const dock = {grid: {}, panels: {current: {id: "current"}}};
// Cast: the field's own literal types are lost on a constant.
const layouts = /** @type {any} */ ({
    phone: {match: "phone", layout: {version: 1, dock, rail: []}}
});
const displayState = {
    deckId: "basic",
    frameCount: 2,
    viewport,
    frame,
    frames,
    blank: false,
    layouts
};
const noModifiers = {shift: false, alt: false, ctrl: false, meta: false};

/** One built message of each kind, as the protocol sends it.
 *
 * @returns {object[]} - The messages.
 */
function everyMessage() {
    return [
        helloMessage(Roles.surface),
        helloMessage(Roles.display, displayState),
        helloMessage(Roles.display, {...displayState, viewport: null}),
        frameChangeMessage(frame),
        blankMessage(true),
        blankMessage(false),
        jumpToFrameMessage(0),
        jumpToFrameMessage(1, false),
        nextMessage(),
        nextMessage(false),
        previousMessage(),
        previousMessage(false),
        customMessage("poll", {question: "Ready?"}),
        previewMessage(true),
        followLinkMessage("link1"),
        keyMessage(" ", noModifiers),
        keyMessage("End", {shift: true, alt: true, ctrl: true, meta: true}),
        viewportMessage({innerWidth: 1200, innerHeight: 400, devicePixelRatio: 2})
    ];
}

describe("protocol messages", () => {
    test("each builder names its message", () => {
        assert.deepEqual(helloMessage(Roles.surface), {name: "hello", role: "surface"});
        assert.deepEqual(helloMessage(Roles.display, displayState), {
            name: MessageNames.hello,
            role: "display",
            ...displayState
        });
        assert.deepEqual(frameChangeMessage(frame), {name: "frameChange", ...frame});
        assert.deepEqual(blankMessage(true), {name: "blank", on: true});
        assert.deepEqual(jumpToFrameMessage(3), {name: "jumpToFrame", index: 3, transition: true});
        assert.deepEqual(nextMessage(false), {name: "next", transition: false});
        assert.deepEqual(previousMessage(), {name: "previous", transition: true});
        assert.deepEqual(customMessage("t", 1), {name: "custom", type: "t", data: 1});
        assert.deepEqual(previewMessage(false), {name: "preview", current: false});
        assert.deepEqual(followLinkMessage("a"), {name: "followLink", id: "a"});
        assert.deepEqual(keyMessage("Home", {...noModifiers, shift: true}), {
            name: "key",
            key: "Home",
            modifiers: {shift: true, alt: false, ctrl: false, meta: false}
        });
    });

    test("every built message reads back unchanged", () => {
        for (const message of everyMessage()) {
            assert.deepEqual(readMessage(message), message, message.name);
        }
    });

    test("a missing transition reads as true", () => {
        assert.deepEqual(readMessage({name: "next"}), nextMessage(true));
        assert.deepEqual(readMessage({name: "previous"}), previousMessage(true));
        assert.deepEqual(readMessage({name: "jumpToFrame", index: 0}), jumpToFrameMessage(0));
    });

    test("fields that are not part of the message are dropped", () => {
        assert.deepEqual(readMessage({name: "blank", on: true, extra: 1}), blankMessage(true));
        assert.deepEqual(
            readMessage({name: "key", key: "a", modifiers: {...noModifiers, fn: true}}),
            keyMessage("a", noModifiers)
        );
    });

    test("a display's hello keeps its frames and drops their other fields", () => {
        const message = helloMessage(Roles.display, displayState);
        const read = readMessage({...message, frames: [{...frames[0], extra: 1}, frame]});
        assert.deepEqual(/** @type {any} */ (read).frames, frames);
    });

    test("a display's hello from before the frames list reads as an empty list", () => {
        const older = {...helloMessage(Roles.display, displayState), frames: undefined};
        assert.deepEqual(/** @type {any} */ (readMessage(older)).frames, []);
    });

    test("is refused when it is not an object or has an unknown name", () => {
        for (const data of [null, undefined, "next", 3, [], {}, {name: "moveToNext"}]) {
            assert.equal(readMessage(data), null, JSON.stringify(data));
        }
    });

    test("a display's hello keeps the deck's layout presets", () => {
        const hello = helloMessage(Roles.display, displayState);
        assert.deepEqual(/** @type {any} */ (readMessage(hello)).layouts, layouts);
    });

    test("a hello from a deck that has no presets field reads as none", () => {
        const older = {...helloMessage(Roles.display, displayState), layouts: undefined};
        assert.deepEqual(/** @type {any} */ (readMessage(older)).layouts, {});
        const state = {...displayState, layouts: undefined};
        assert.deepEqual(/** @type {any} */ (helloMessage(Roles.display, state)).layouts, {});
    });

    test("a bad preset is dropped, never the whole hello", () => {
        const hello = {
            ...helloMessage(Roles.display, displayState),
            layouts: {...layouts, bad: {match: "tablet"}, "a.b": layouts.phone}
        };
        const read = /** @type {any} */ (readMessage(hello));
        assert.equal(read.deckId, "basic");
        assert.deepEqual(read.layouts, layouts);
        const worse = {...hello, layouts: "none"};
        assert.deepEqual(/** @type {any} */ (readMessage(worse)).layouts, {});
    });

    test("a surface's hello carries no presets", () => {
        assert.deepEqual(readMessage(helloMessage(Roles.surface)), {
            name: "hello",
            role: "surface"
        });
    });

    test("is refused with a malformed field", () => {
        const bad = [
            {name: "hello"},
            {name: "hello", role: "audience"},
            {...helloMessage(Roles.display, displayState), deckId: 3},
            {...helloMessage(Roles.display, displayState), frameCount: -1},
            {...helloMessage(Roles.display, displayState), frameCount: 1.5},
            {...helloMessage(Roles.display, displayState), viewport: {width: 0}},
            {...helloMessage(Roles.display, displayState), frame: null},
            {...helloMessage(Roles.display, displayState), blank: "no"},
            {...helloMessage(Roles.display, displayState), frames: "all"},
            {...helloMessage(Roles.display, displayState), frames: null},
            {...helloMessage(Roles.display, displayState), frames: [frame, {index: 2}]},
            {...helloMessage(Roles.display, displayState), frames: [frame, null]},
            {...frameChangeMessage(frame), index: -1},
            {...frameChangeMessage(frame), index: "1"},
            {...frameChangeMessage(frame), id: 2},
            {...frameChangeMessage(frame), title: undefined},
            {...frameChangeMessage(frame), notes: null},
            {name: "blank"},
            {name: "blank", on: 1},
            {name: "jumpToFrame"},
            {name: "jumpToFrame", index: 0.5},
            {name: "jumpToFrame", index: 0, transition: "yes"},
            {name: "next", transition: 0},
            {name: "previous", transition: null},
            {name: "custom", data: 1},
            {name: "custom", type: "", data: 1},
            {name: "preview"},
            {name: "preview", current: "true"},
            {name: "followLink"},
            {name: "followLink", id: ""},
            {name: "key", modifiers: noModifiers},
            {name: "key", key: "", modifiers: noModifiers},
            {name: "key", key: " "},
            {name: "key", key: " ", modifiers: null},
            {name: "key", key: " ", modifiers: {shift: false, alt: false, ctrl: false}},
            {name: "key", key: " ", modifiers: {...noModifiers, shift: "no"}},
            {name: "viewport", width: 0, height: 1, pixelRatio: 1}
        ];
        for (const data of bad) {
            assert.equal(readMessage(data), null, JSON.stringify(data));
        }
    });

    test("a deck id is the page's file name without .sozi.html", () => {
        assert.equal(deckIdOf("/home/tim/talks/basic.sozi.html"), "basic");
        assert.equal(deckIdOf("/talks/my%20talk.sozi.html"), "my talk");
        assert.equal(deckIdOf("/talks/index.html"), "index.html");
        assert.equal(deckIdOf(""), "");
    });
});
