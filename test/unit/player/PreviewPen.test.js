import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {PreviewPen} from "../../../src/js/player/PreviewPen.js";
import {EMPTY_DRAWINGS, PenTools} from "../../../src/js/protocol/drawings.js";

/** Stand-in for the deck's SVG root: it keeps its listeners, with their phase.
 *
 * @returns {any} - The fake root; `fire(type, fields)` dispatches an event to it.
 */
function fakeRoot() {
    const listeners = [];
    return {
        listeners,
        captured: [],
        addEventListener(type, listener, capture) {
            listeners.push({type, listener, capture});
        },
        removeEventListener(type, listener, capture) {
            const i = listeners.findIndex(
                l => l.type === type && l.listener === listener && l.capture === capture
            );
            if (i >= 0) {
                listeners.splice(i, 1);
            }
        },
        setPointerCapture(id) {
            this.captured.push(id);
        },
        fire(type, fields = {}) {
            const evt = {
                type,
                button: 0,
                pointerId: 1,
                pointerType: "mouse",
                pressure: 0.5,
                stopped: false,
                prevented: false,
                preventDefault() {
                    this.prevented = true;
                },
                stopImmediatePropagation() {
                    this.stopped = true;
                },
                stopPropagation() {
                    this.stopped = true;
                },
                ...fields
            };
            for (const l of listeners.filter(l => l.type === type)) {
                l.listener(evt);
            }
            return evt;
        }
    };
}

/** The drawing group, whose screen CTM is twice the canvas units, moved by (10, 20).
 *
 * @returns {any} - The fake group.
 */
function fakeLayer() {
    return {
        getScreenCTM: () => ({
            inverse: () => ({a: 0.5, b: 0, c: 0, d: 0.5, e: -5, f: -10})
        })
    };
}

/** A pen on a fake root, with the messages it reports.
 *
 * @param {any} [drawings] - The drawings the preview holds.
 * @returns {any} - The pen, its root and the messages.
 */
function penOn(drawings = EMPTY_DRAWINGS) {
    const root = fakeRoot();
    const sent = [];
    const pen = new PreviewPen({
        root,
        layer: fakeLayer(),
        viewport: {width: 400, height: 200},
        onDrawing: message => sent.push(message),
        drawings: () => drawings
    });
    return {pen, root, sent};
}

/** The fields of a pointer at a client point.
 *
 * @param {number} x - Its client x.
 * @param {number} y - Its client y.
 * @param {object} [more] - Other fields.
 * @returns {object} - The fields.
 */
function at(x, y, more = {}) {
    return {clientX: x, clientY: y, ...more};
}

const pen = {pointerType: "pen"};

describe("PreviewPen", () => {
    test("listens in the capture phase, and dispose removes every listener", () => {
        const {pen: p, root} = penOn();
        assert.ok(root.listeners.length > 0);
        assert.ok(root.listeners.every(l => l.capture === true));
        p.dispose();
        assert.deepEqual(root.listeners, []);
    });

    test("a stylus draws in pan mode, in canvas units, and its events are stopped", () => {
        const {root, sent} = penOn();
        const down = root.fire("pointerdown", at(30, 40, {...pen, pressure: 0.3}));
        const move = root.fire("pointermove", at(50, 60, {...pen, pressure: 0.7}));
        const up = root.fire("pointerup", at(50, 60, {...pen, pressure: 0}));
        assert.ok([down, move, up].every(evt => evt.stopped && evt.prevented));
        assert.deepEqual(root.captured, [1]);
        const [begin, points, end] = sent;
        assert.deepEqual(
            sent.map(m => m.name),
            ["strokeBegin", "strokePoints", "strokeEnd"]
        );
        assert.equal(begin.tool, PenTools.pen);
        assert.match(begin.color, /^#[0-9a-f]{6}$/);
        assert.deepEqual(begin.points, [[10, 10, 0.3]]);
        assert.deepEqual(points, {name: "strokePoints", id: begin.id, points: [[20, 20, 0.7]]});
        assert.deepEqual(end, {name: "strokeEnd", id: begin.id});
    });

    test("a mouse in pan mode reports nothing and is not stopped", () => {
        const {root, sent} = penOn();
        const down = root.fire("pointerdown", at(30, 40));
        const move = root.fire("pointermove", at(50, 60));
        root.fire("pointerup", at(50, 60));
        assert.deepEqual(sent, []);
        assert.equal(down.stopped || down.prevented || move.stopped, false);
        assert.deepEqual(root.captured, []);
    });

    test("in draw mode a mouse or a finger draws with the chosen tool, colour and width", () => {
        for (const pointerType of ["mouse", "touch"]) {
            const {pen: p, root, sent} = penOn();
            p.setTool({draw: true, tool: PenTools.highlighter, color: "#00ff00", width: 0.03});
            root.fire("pointerdown", at(30, 40, {pointerType}));
            const [begin] = sent;
            assert.equal(begin.tool, PenTools.highlighter);
            assert.equal(begin.color, "#00ff00");
            // 3% of the shorter side, 200 pixels, at half a canvas unit a pixel.
            assert.ok(Math.abs(begin.width - 3) < 1e-9, String(begin.width));
        }
    });

    test("the event's pressure reaches the points, and a reported 0 becomes 0.5", () => {
        const {root, sent} = penOn();
        root.fire("pointerdown", at(30, 40, {...pen, pressure: 0}));
        root.fire("pointermove", at(30, 40, {...pen, pressure: 0.9}));
        root.fire("pointermove", at(30, 40, {...pen, pressure: 0}));
        assert.deepEqual(
            sent.map(m => m.points.map(point => point[2])),
            [[0.5], [0.9], [0.5]]
        );
    });

    test("each coalesced event gives one point", () => {
        const {root, sent} = penOn();
        root.fire("pointerdown", at(10, 20, pen));
        root.fire(
            "pointermove",
            at(50, 60, {
                ...pen,
                getCoalescedEvents: () => [at(30, 40, {pressure: 0.2}), at(50, 60, {pressure: 0.4})]
            })
        );
        assert.deepEqual(sent[1].points, [
            [10, 10, 0.2],
            [20, 20, 0.4]
        ]);
    });

    test("a second pointer during a stroke is ignored, and goes on to the gestures", () => {
        const {root, sent} = penOn();
        root.fire("pointerdown", at(10, 20, pen));
        const other = root.fire("pointerdown", at(90, 90, {...pen, pointerId: 2}));
        const otherMove = root.fire("pointermove", at(95, 95, {...pen, pointerId: 2}));
        root.fire("pointerup", at(95, 95, {...pen, pointerId: 2}));
        assert.equal(other.stopped || otherMove.stopped, false);
        assert.deepEqual(
            sent.map(m => m.name),
            ["strokeBegin"]
        );
    });

    test("pointercancel ends the stroke", () => {
        const {root, sent} = penOn();
        root.fire("pointerdown", at(10, 20, pen));
        root.fire("pointercancel", at(10, 20, pen));
        assert.deepEqual(sent.at(-1), {name: "strokeEnd", id: sent[0].id});
        root.fire("pointermove", at(30, 40, pen));
        assert.equal(sent.length, 2);
    });

    test("each stroke has an id of its own", () => {
        const {root, sent} = penOn();
        for (let i = 0; i < 2; i++) {
            root.fire("pointerdown", at(10, 20, pen));
            root.fire("pointerup", at(10, 20, pen));
        }
        const ids = sent.filter(m => m.name === "strokeBegin").map(m => m.id);
        assert.equal(new Set(ids).size, 2);
        assert.ok(ids.every(id => /^p-/.test(id) && id.length <= 64));
    });

    test("the eraser reports each stroke it passes over once", () => {
        const line = {
            id: "a",
            tool: "pen",
            color: "#ff0000",
            width: 1,
            done: true,
            points: [
                [0, 10, 0.5],
                [100, 10, 0.5]
            ]
        };
        const far = {...line, id: "b", points: [[0, 90, 0.5]]};
        const {pen: p, root, sent} = penOn({visible: true, strokes: [line, far]});
        p.setTool({draw: true, tool: PenTools.eraser, color: "#ff0000", width: 0.004});
        // Canvas (10, 10), then (20, 11), both on stroke "a".
        root.fire("pointerdown", at(30, 40));
        root.fire("pointermove", at(50, 42));
        root.fire("pointerup", at(50, 42));
        assert.deepEqual(sent, [{name: "strokeErase", id: "a"}]);
    });

    test("the click that ends a stroke is swallowed before it reaches a link", () => {
        const {root} = penOn();
        root.fire("pointerdown", at(10, 20, pen));
        root.fire("pointerup", at(10, 20, pen));
        assert.equal(root.fire("click", at(10, 20)).stopped, true);
        assert.equal(root.fire("click", at(10, 20)).stopped, false);
    });
});
