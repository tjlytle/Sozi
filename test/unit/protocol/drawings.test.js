import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    DRAWING_COMMANDS,
    EMPTY_DRAWINGS,
    MAX_POINTS_PER_MESSAGE,
    MAX_STROKE_POINTS,
    MAX_TOOL_WIDTH,
    PenTools,
    Tools,
    drawingClearMessage,
    drawingToolMessage,
    drawingUndoMessage,
    drawingVisibleMessage,
    drawingsMessage,
    readDrawingClear,
    readDrawingTool,
    readDrawingUndo,
    readDrawingVisible,
    readDrawings,
    readDrawingsMessage,
    readStrokeBegin,
    readStrokeEnd,
    readStrokeErase,
    readStrokePoints,
    strokeBeginMessage,
    strokeEndMessage,
    strokeEraseMessage,
    strokePointsMessage
} from "../../../src/js/protocol/drawings.js";
import {readMessage} from "../../../src/js/protocol/messages.js";

/** @type {[number, number, number][]} */
const points = [
    [10, 20, 0.5],
    [12, 21, 0.6]
];
const begun = {id: "s1", tool: Tools.pen, color: "#ff0000", width: 6, points};
const stroke = {...begun, done: true};
const drawings = {visible: true, strokes: [stroke]};

/** A number of points, all alike.
 *
 * @param {number} count - How many.
 * @returns {number[][]} - The points.
 */
function manyPoints(count) {
    return Array.from({length: count}, () => [1, 2, 0.5]);
}

describe("protocol drawings", () => {
    test("each builder names its message", () => {
        assert.deepEqual(strokeBeginMessage(begun), {name: "strokeBegin", ...begun});
        assert.deepEqual(strokePointsMessage("s1", points), {
            name: "strokePoints",
            id: "s1",
            points
        });
        assert.deepEqual(strokeEndMessage("s1"), {name: "strokeEnd", id: "s1"});
        assert.deepEqual(strokeEraseMessage("s1"), {name: "strokeErase", id: "s1"});
        assert.deepEqual(drawingUndoMessage(), {name: "drawingUndo"});
        assert.deepEqual(drawingClearMessage(), {name: "drawingClear"});
        assert.deepEqual(drawingVisibleMessage(false), {name: "drawingVisible", visible: false});
        assert.deepEqual(drawingsMessage(drawings), {name: "drawings", ...drawings});
    });

    test("every built message reads back unchanged, alone and through readMessage", () => {
        /** @type {[(data: any) => any, any][]} */
        const pairs = [
            [readStrokeBegin, strokeBeginMessage(begun)],
            [readStrokePoints, strokePointsMessage("s1", points)],
            [readStrokeEnd, strokeEndMessage("s1")],
            [readStrokeErase, strokeEraseMessage("s1")],
            [readDrawingUndo, drawingUndoMessage()],
            [readDrawingClear, drawingClearMessage()],
            [readDrawingVisible, drawingVisibleMessage(true)],
            [readDrawingsMessage, drawingsMessage(drawings)]
        ];
        for (const [read, message] of pairs) {
            assert.deepEqual(read(message), message, message.name);
            assert.deepEqual(readMessage(message), message, message.name);
        }
    });

    test("the seven commands a surface sends are named", () => {
        assert.deepEqual([...DRAWING_COMMANDS].sort(), [
            "drawingClear",
            "drawingUndo",
            "drawingVisible",
            "strokeBegin",
            "strokeEnd",
            "strokeErase",
            "strokePoints"
        ]);
    });

    test("fields that are not part of a message are dropped", () => {
        const read = readStrokeBegin({...strokeBeginMessage(begun), extra: 1});
        assert.deepEqual(read, strokeBeginMessage(begun));
        assert.deepEqual(readDrawings({...drawings, extra: 1}), drawings);
    });

    test("a stroke is refused for a tool there is not", () => {
        assert.equal(readStrokeBegin({...strokeBeginMessage(begun), tool: "marker"}), null);
        assert.ok(readStrokeBegin({...strokeBeginMessage(begun), tool: Tools.highlighter}));
    });

    test("a stroke is refused for a colour that is not #rrggbb", () => {
        for (const color of ["red", "#f00", "#ff0000aa", "red; fill: url(x)", "#gg0000", 0]) {
            assert.equal(
                readStrokeBegin({...strokeBeginMessage(begun), color}),
                null,
                String(color)
            );
        }
        assert.ok(readStrokeBegin({...strokeBeginMessage(begun), color: "#00AA00"}));
    });

    test("a stroke is refused for a width that is not finite and above 0", () => {
        for (const width of [0, -1, Infinity, NaN, "6"]) {
            assert.equal(
                readStrokeBegin({...strokeBeginMessage(begun), width}),
                null,
                String(width)
            );
        }
    });

    test("a point is refused for a pressure outside 0..1 or a coordinate not finite", () => {
        for (const point of [[1, 2, -0.1], [1, 2, 1.1], [1, NaN, 0.5], [1, 2], "1,2,0.5"]) {
            assert.equal(readStrokePoints({name: "strokePoints", id: "s1", points: [point]}), null);
        }
        assert.ok(readStrokePoints({name: "strokePoints", id: "s1", points: [[1, 2, 0]]}));
        assert.ok(readStrokePoints({name: "strokePoints", id: "s1", points: [[1, 2, 1]]}));
    });

    test("an id is refused when it is empty, too long or not a string", () => {
        for (const id of ["", "x".repeat(65), 7, null]) {
            assert.equal(readStrokeEnd({name: "strokeEnd", id}), null, String(id));
            assert.equal(readStrokeErase({name: "strokeErase", id}), null, String(id));
        }
        assert.ok(readStrokeEnd({name: "strokeEnd", id: "x".repeat(64)}));
    });

    test("one message carries at most 1000 points", () => {
        assert.equal(MAX_POINTS_PER_MESSAGE, 1000);
        const full = manyPoints(MAX_POINTS_PER_MESSAGE);
        assert.ok(readStrokePoints({name: "strokePoints", id: "s1", points: full}));
        assert.ok(readStrokeBegin({...strokeBeginMessage(begun), points: full}));
        const over = manyPoints(MAX_POINTS_PER_MESSAGE + 1);
        assert.equal(readStrokePoints({name: "strokePoints", id: "s1", points: over}), null);
        assert.equal(readStrokeBegin({...strokeBeginMessage(begun), points: over}), null);
    });

    test("drawingVisible is refused without a boolean", () => {
        assert.equal(readDrawingVisible({name: "drawingVisible", visible: "yes"}), null);
    });

    test("readDrawings reads a whole stroke list, open strokes included", () => {
        const open = {...stroke, id: "s2", done: false};
        const both = {visible: false, strokes: [stroke, open]};
        assert.deepEqual(readDrawings(both), both);
        assert.deepEqual(readDrawings(EMPTY_DRAWINGS), EMPTY_DRAWINGS);
    });

    test("readDrawings takes a stroke as long as the model keeps, and no longer", () => {
        const long = {...stroke, points: manyPoints(MAX_STROKE_POINTS)};
        assert.ok(readDrawings({visible: true, strokes: [long]}));
        const longer = {...stroke, points: manyPoints(MAX_STROKE_POINTS + 1)};
        assert.equal(readDrawings({visible: true, strokes: [longer]}), null);
    });

    test("readDrawings refuses a malformed list or stroke", () => {
        for (const bad of [
            null,
            [],
            {visible: true},
            {visible: "yes", strokes: []},
            {visible: true, strokes: [{...stroke, done: "yes"}]},
            {visible: true, strokes: [{...stroke, color: "blue"}]},
            {visible: true, strokes: [null]}
        ]) {
            assert.equal(readDrawings(bad), null, JSON.stringify(bad));
        }
    });

    test("the empty drawings are visible and hold no stroke", () => {
        assert.deepEqual(EMPTY_DRAWINGS, {visible: true, strokes: []});
        assert.ok(Object.isFrozen(EMPTY_DRAWINGS));
    });

    test("drawingTool carries the mode, the tool, the colour and the width", () => {
        const tool = {draw: true, tool: PenTools.eraser, color: "#00ff00", width: 0.004};
        assert.deepEqual(drawingToolMessage(tool), {name: "drawingTool", ...tool});
        assert.deepEqual(readDrawingTool(drawingToolMessage(tool)), drawingToolMessage(tool));
        assert.deepEqual(readMessage(drawingToolMessage(tool)), drawingToolMessage(tool));
        const widest = {...tool, draw: false, tool: PenTools.highlighter, width: MAX_TOOL_WIDTH};
        assert.deepEqual(readDrawingTool(drawingToolMessage(widest)), drawingToolMessage(widest));
    });

    test("drawingTool is refused with an unknown tool, a bad colour or a width out of range", () => {
        const tool = {name: "drawingTool", draw: true, tool: "pen", color: "#00ff00", width: 0.004};
        for (const bad of [
            {tool: "brush"},
            {tool: undefined},
            {color: "green"},
            {color: "#00ff00; x"},
            {width: 0},
            {width: -0.01},
            {width: MAX_TOOL_WIDTH + 0.001},
            {width: Number.NaN},
            {draw: "yes"}
        ]) {
            assert.equal(readDrawingTool({...tool, ...bad}), null, JSON.stringify(bad));
            assert.equal(readMessage({...tool, ...bad}), null, JSON.stringify(bad));
        }
    });
});
