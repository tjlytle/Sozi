import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    frameChangeMessage,
    blankMessage,
    jumpToFrameMessage,
    nextMessage,
    previousMessage,
    customMessage,
    previewMessage,
    followLinkMessage,
    keyMessage,
    readMessage
} from "../../../src/js/protocol/messages.js";
import {viewportMessage} from "../../../src/js/protocol/viewport.js";
import {
    TimerActions,
    timerActionMessage,
    timerMessage,
    timerTargetMessage
} from "../../../src/js/protocol/timer.js";
import {
    cameraMessage,
    cameraMoveMessage,
    cameraResetMessage
} from "../../../src/js/protocol/camera.js";

const timer = {elapsedMs: 1500, running: true, targetMs: 60000};
const camera = {offFrame: true, zoom: 2, x: -0.5, y: 0.25};
const frame = {index: 1, id: "frame2", title: "Two", notes: "<p>Second</p>"};
const noModifiers = {shift: false, alt: false, ctrl: false, meta: false};

/** One built message of each kind but `hello`, as the protocol sends it.
 *
 * @returns {object[]} - The messages.
 */
function everyMessage() {
    return [
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
        viewportMessage({innerWidth: 1200, innerHeight: 400, devicePixelRatio: 2}),
        timerMessage(timer),
        timerActionMessage(TimerActions.reset),
        timerTargetMessage(60000),
        timerTargetMessage(null)
    ];
}

describe("protocol messages", () => {
    test("each builder names its message", () => {
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

    test("is refused when it is not an object or has an unknown name", () => {
        for (const data of [null, undefined, "next", 3, [], {}, {name: "moveToNext"}]) {
            assert.equal(readMessage(data), null, JSON.stringify(data));
        }
    });

    test("the camera's messages are read through readMessage", () => {
        const move = {x: 0.1, y: 0, zoom: 1, atX: 0, atY: 0};
        assert.deepEqual(readMessage(cameraMoveMessage(move)), cameraMoveMessage(move));
        assert.deepEqual(readMessage(cameraResetMessage()), cameraResetMessage());
        assert.deepEqual(readMessage(cameraMessage(camera)), cameraMessage(camera));
        assert.equal(readMessage({...cameraMoveMessage(move), zoom: 0}), null);
    });

    test("the timer's messages are refused when a field is malformed", () => {
        for (const bad of [
            {name: "timer", ...timer, running: "yes"},
            {name: "timerAction", action: "stop"},
            {name: "timerTarget", targetMs: 0}
        ]) {
            assert.equal(readMessage(bad), null, bad.name);
        }
    });

    test("is refused with a malformed field", () => {
        const bad = [
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
});
