import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {DisplayDrawings} from "../../../src/js/player/DisplayDrawings.js";
import {
    EMPTY_DRAWINGS,
    Tools,
    drawingUndoMessage,
    drawingVisibleMessage,
    strokeBeginMessage
} from "../../../src/js/protocol/drawings.js";

const begun = {id: "s1", tool: Tools.pen, color: "#ff0000", width: 6, points: [[1, 2, 0.5]]};
const finished = {visible: true, strokes: [{...begun, done: true}]};

/** Build the drawings on a fake layer.
 *
 * @returns {any} - The drawings, what the layer painted, what was reported, and `state`, whose
 *   `preview` `isPreview` reads.
 */
function drawingsOnFakes() {
    const rendered = [];
    const reported = [];
    const state = {preview: false};
    const drawings = new DisplayDrawings({
        drawingLayer: {render: d => rendered.push(d)},
        isPreview: () => state.preview,
        report: message => reported.push(message)
    });
    return {drawings, rendered, reported, state};
}

describe("DisplayDrawings", () => {
    test("starts empty", () => {
        const {drawings} = drawingsOnFakes();
        assert.equal(drawings.current, EMPTY_DRAWINGS);
    });

    test("a command that changes the drawings is painted and reported", () => {
        const {drawings, rendered, reported} = drawingsOnFakes();
        drawings.draw(strokeBeginMessage(begun));
        assert.deepEqual(drawings.current.strokes, [{...begun, done: false}]);
        assert.deepEqual(rendered, [drawings.current]);
        assert.deepEqual(reported, [strokeBeginMessage(begun)]);
    });

    test("a command that changes nothing is neither painted nor reported", () => {
        const {drawings, rendered, reported} = drawingsOnFakes();
        drawings.draw(drawingUndoMessage());
        drawings.draw(drawingVisibleMessage(true));
        assert.equal(drawings.current, EMPTY_DRAWINGS);
        assert.deepEqual(rendered, []);
        assert.deepEqual(reported, []);
    });

    test("replace holds and paints the drawings in a preview", () => {
        const {drawings, rendered, reported, state} = drawingsOnFakes();
        state.preview = true;
        drawings.replace(finished);
        assert.equal(drawings.current, finished);
        assert.deepEqual(rendered, [finished]);
        assert.deepEqual(reported, []);
    });

    test("replace is ignored outside a preview", () => {
        const {drawings, rendered} = drawingsOnFakes();
        drawings.replace(finished);
        assert.equal(drawings.current, EMPTY_DRAWINGS);
        assert.deepEqual(rendered, []);
    });

    test("setTool reaches the pen, and does nothing before there is one", () => {
        const {drawings} = drawingsOnFakes();
        const tool = {draw: true, tool: Tools.pen, color: "#ff0000", width: 0.004};
        drawings.setTool(tool);
        const tools = [];
        drawings.usePen({setTool: t => tools.push(t)});
        drawings.setTool(tool);
        assert.deepEqual(tools, [tool]);
    });

    test("setTool does nothing when the preview has no pen", () => {
        const {drawings} = drawingsOnFakes();
        drawings.usePen(null);
        assert.doesNotThrow(() => drawings.setTool({draw: false}));
    });
});
