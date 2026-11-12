import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    EMPTY_DRAWINGS,
    MAX_STROKE_POINTS,
    Tools,
    drawingClearMessage,
    drawingUndoMessage,
    drawingVisibleMessage,
    drawingsMessage,
    strokeBeginMessage,
    strokeEndMessage,
    strokeEraseMessage,
    strokePointsMessage
} from "../../../src/js/protocol/drawings.js";
import {
    addPoints,
    applyDrawing,
    beginStroke,
    clearStrokes,
    endStroke,
    eraseStroke,
    setVisible,
    undoStroke
} from "../../../src/js/protocol/strokes.js";

/** @type {[number, number, number][]} */
const points = [
    [10, 20, 0.5],
    [12, 21, 0.6]
];

/** The begin message of a stroke.
 *
 * @param {string} id - The stroke's id.
 * @returns {any} - Its fields.
 */
function begun(id) {
    return {id, tool: Tools.pen, color: "#ff0000", width: 6, points};
}

/** Drawings holding finished strokes, in order.
 *
 * @param {...string} ids - Their ids.
 * @returns {any} - The drawings.
 */
function drawn(...ids) {
    return ids.reduce(
        (drawings, id) => endStroke(beginStroke(drawings, begun(id)), id),
        EMPTY_DRAWINGS
    );
}

/** The ids of the strokes of some drawings.
 *
 * @param {any} drawings - The drawings.
 * @returns {string[]} - Their ids, in order.
 */
function ids(drawings) {
    return drawings.strokes.map(stroke => stroke.id);
}

describe("protocol strokes", () => {
    test("a begun stroke is open and keeps its fields", () => {
        const drawings = beginStroke(EMPTY_DRAWINGS, begun("s1"));
        assert.deepEqual(drawings.strokes, [{...begun("s1"), done: false}]);
        assert.deepEqual(EMPTY_DRAWINGS.strokes, [], "the drawings before are left alone");
    });

    test("points go on an open stroke, and end closes it", () => {
        let drawings = beginStroke(EMPTY_DRAWINGS, begun("s1"));
        drawings = addPoints(drawings, "s1", [[14, 22, 0.7]]);
        assert.deepEqual(drawings.strokes[0].points, [...points, [14, 22, 0.7]]);
        drawings = endStroke(drawings, "s1");
        assert.equal(drawings.strokes[0].done, true);
    });

    test("points to an unknown or finished stroke change nothing", () => {
        const drawings = drawn("s1");
        assert.equal(addPoints(drawings, "s1", [[1, 1, 1]]), drawings);
        assert.equal(addPoints(drawings, "nope", [[1, 1, 1]]), drawings);
        assert.equal(endStroke(drawings, "nope"), drawings);
        assert.equal(eraseStroke(drawings, "nope"), drawings);
    });

    test("a second begin with an id taken changes nothing", () => {
        const drawings = drawn("s1");
        assert.equal(beginStroke(drawings, {...begun("s1"), color: "#0000ff"}), drawings);
    });

    test("a stroke stops taking points at 10 000", () => {
        assert.equal(MAX_STROKE_POINTS, 10000);
        const many = Array.from({length: 999}, () => [1, 1, 0.5]);
        let drawings = beginStroke(EMPTY_DRAWINGS, {...begun("s1"), points: many});
        for (let i = 0; i < 11; i++) {
            drawings = addPoints(drawings, "s1", many);
        }
        assert.equal(drawings.strokes[0].points.length, MAX_STROKE_POINTS);
        assert.equal(addPoints(drawings, "s1", many), drawings);
    });

    test("undo removes the last finished stroke, not one still being drawn", () => {
        const drawings = beginStroke(drawn("a", "b"), begun("open"));
        assert.deepEqual(ids(undoStroke(drawings)), ["a", "open"]);
        assert.equal(undoStroke(beginStroke(EMPTY_DRAWINGS, begun("open"))).strokes.length, 1);
        assert.equal(undoStroke(EMPTY_DRAWINGS), EMPTY_DRAWINGS);
    });

    test("erase removes one stroke by id, finished or not", () => {
        assert.deepEqual(ids(eraseStroke(drawn("a", "b", "c"), "b")), ["a", "c"]);
        const open = beginStroke(EMPTY_DRAWINGS, begun("open"));
        assert.deepEqual(ids(eraseStroke(open, "open")), []);
    });

    test("clear removes every stroke and keeps the visibility", () => {
        const hidden = setVisible(drawn("a", "b"), false);
        assert.deepEqual(clearStrokes(hidden), {visible: false, strokes: []});
        assert.equal(clearStrokes(EMPTY_DRAWINGS), EMPTY_DRAWINGS);
    });

    test("hide and show keep the strokes", () => {
        const drawings = drawn("a");
        const hidden = setVisible(drawings, false);
        assert.equal(hidden.visible, false);
        assert.deepEqual(hidden.strokes, drawings.strokes);
        assert.deepEqual(setVisible(hidden, true), drawings);
        assert.equal(setVisible(drawings, true), drawings);
    });

    test("applyDrawing carries out each command a surface sends", () => {
        let drawings = EMPTY_DRAWINGS;
        for (const message of [
            strokeBeginMessage(begun("a")),
            strokePointsMessage("a", [[14, 22, 0.7]]),
            strokeEndMessage("a"),
            strokeBeginMessage(begun("b")),
            strokeEndMessage("b"),
            strokeBeginMessage(begun("c")),
            strokeEndMessage("c"),
            drawingUndoMessage(),
            strokeEraseMessage("a"),
            drawingVisibleMessage(false)
        ]) {
            drawings = applyDrawing(drawings, message);
        }
        assert.deepEqual(drawings, {visible: false, strokes: [{...begun("b"), done: true}]});
        assert.deepEqual(applyDrawing(drawings, drawingClearMessage()).strokes, []);
    });

    test("applyDrawing leaves the drawings as they are for any other message", () => {
        const drawings = drawn("a");
        assert.equal(applyDrawing(drawings, drawingsMessage(EMPTY_DRAWINGS)), drawings);
        assert.equal(applyDrawing(drawings, /** @type {any} */ ({name: "next"})), drawings);
    });
});
