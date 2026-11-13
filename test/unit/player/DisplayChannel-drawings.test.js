// The drawings' side of DisplayChannel: a surface's stroke commands change the drawings, which
// the deck draws and the channel relays, and a later hello carries them. The rest of the
// channel is in DisplayChannel.test.js.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {fakeTransport} from "./fakeDeck.js";
import {displayHello, startedDisplay} from "./displayWorld.js";
import {Roles, helloMessage} from "../../../src/js/protocol/hello.js";
import {previewMessage} from "../../../src/js/protocol/messages.js";
import {
    EMPTY_DRAWINGS,
    Tools,
    drawingToolMessage,
    drawingUndoMessage,
    drawingVisibleMessage,
    drawingsMessage,
    strokeBeginMessage,
    strokeEndMessage
} from "../../../src/js/protocol/drawings.js";

const begun = {id: "s1", tool: Tools.pen, color: "#ff0000", width: 6, points: [[1, 2, 0.5]]};
const finished = {visible: true, strokes: [{...begun, done: true}]};

describe("DisplayChannel and the drawings", () => {
    test("a surface's stroke is drawn as it goes and relayed to every link", () => {
        const {channel, transport, drawingLayer} = startedDisplay();
        const other = fakeTransport();
        channel.addTransport(other);
        other.sent.length = 0;
        transport.deliver(strokeBeginMessage(begun));
        assert.deepEqual(drawingLayer.rendered.at(-1).strokes, [{...begun, done: false}]);
        transport.deliver(strokeEndMessage("s1"));
        assert.deepEqual(drawingLayer.rendered.at(-1), finished);
        assert.deepEqual(transport.sent, [strokeBeginMessage(begun), strokeEndMessage("s1")]);
        assert.deepEqual(other.sent, transport.sent);
    });

    test("a command that changes nothing is neither drawn nor relayed", () => {
        const {transport, drawingLayer} = startedDisplay();
        transport.deliver(drawingUndoMessage());
        transport.deliver(drawingVisibleMessage(true));
        assert.deepEqual(drawingLayer.rendered, []);
        assert.deepEqual(transport.sent, []);
    });

    test("a hello carries the drawings as they are", () => {
        const {transport} = startedDisplay();
        transport.deliver(strokeBeginMessage(begun));
        transport.deliver(strokeEndMessage("s1"));
        transport.sent.length = 0;
        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(transport.sent, [displayHello({drawings: finished})]);
    });

    test("a display that has drawn nothing says hello with empty drawings", () => {
        const {transport} = startedDisplay();
        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(/** @type {any} */ (transport.sent[0]).drawings, EMPTY_DRAWINGS);
    });

    test("a preview draws a surface's stroke and reports nothing", () => {
        const {transport, drawingLayer} = startedDisplay();
        transport.deliver(previewMessage(true));
        transport.deliver(strokeBeginMessage(begun));
        assert.equal(drawingLayer.rendered.length, 1);
        assert.deepEqual(transport.sent, []);
    });

    test("drawings replace a preview's drawings, and are drawn", () => {
        const {transport, drawingLayer} = startedDisplay();
        transport.deliver(previewMessage(false));
        transport.deliver(drawingsMessage(finished));
        assert.deepEqual(drawingLayer.rendered, [finished]);
        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(/** @type {any} */ (transport.sent[0]).drawings, finished);
    });

    test("the current preview's pen takes the drawing tool, and its strokes go to the presenter", () => {
        const {transport, previews, drawingLayer} = startedDisplay();
        transport.deliver(previewMessage(true));
        const tool = {draw: true, tool: "pen", color: "#ff0000", width: 0.004};
        transport.deliver(drawingToolMessage(tool));
        assert.deepEqual(previews[0].pen.tools, [drawingToolMessage(tool)]);
        previews[0].onDrawing(strokeBeginMessage(begun));
        assert.deepEqual(transport.sent, [strokeBeginMessage(begun)]);
        // The preview draws what the display relays back, not its own stroke.
        assert.deepEqual(drawingLayer.rendered, []);
    });

    test("the eraser reads the drawings the preview holds", () => {
        const {transport, previews} = startedDisplay();
        transport.deliver(previewMessage(true));
        transport.deliver(drawingsMessage(finished));
        assert.deepEqual(previews[0].drawings(), finished);
    });

    test("a drawing tool is ignored outside a preview and by another preview", () => {
        const tool = drawingToolMessage({draw: true, tool: "pen", color: "#ff0000", width: 0.004});
        const display = startedDisplay();
        display.transport.deliver(tool);
        const other = startedDisplay();
        other.transport.deliver(previewMessage(false));
        other.transport.deliver(tool);
        assert.equal(other.previews[0].pen, null);
        assert.deepEqual([...display.transport.sent, ...other.transport.sent], []);
    });

    test("drawings are ignored outside a preview", () => {
        const {transport, drawingLayer} = startedDisplay();
        transport.deliver(drawingsMessage(finished));
        assert.deepEqual(drawingLayer.rendered, []);
        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(/** @type {any} */ (transport.sent[0]).drawings, EMPTY_DRAWINGS);
    });
});
