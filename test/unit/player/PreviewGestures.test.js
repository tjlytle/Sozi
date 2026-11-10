import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {PreviewGestures} from "../../../src/js/player/PreviewGestures.js";
import {DRAG_THRESHOLD_PX, SCALE_FACTOR} from "../../../src/js/player/PlayerController.js";

/** Stand-in for the deck's SVG root: it keeps its listeners and its classes.
 *
 * @returns {any} - The fake root; `fire(type, fields)` dispatches an event to it.
 */
function fakeRoot() {
    const listeners = new Map();
    const classes = new Set();
    return {
        listeners,
        classes,
        captured: [],
        classList: {
            add: name => classes.add(name),
            remove: name => classes.delete(name)
        },
        addEventListener(type, listener, options) {
            listeners.set(type, {listener, options});
        },
        removeEventListener(type, listener) {
            if (listeners.get(type)?.listener === listener) {
                listeners.delete(type);
            }
        },
        setPointerCapture(id) {
            this.captured.push(id);
        },
        fire(type, fields = {}) {
            const evt = {
                type,
                defaultPrevented: false,
                propagationStopped: false,
                preventDefault() {
                    this.defaultPrevented = true;
                },
                stopPropagation() {
                    this.propagationStopped = true;
                },
                ...fields
            };
            listeners.get(type)?.listener(evt);
            return evt;
        }
    };
}

/** Gestures on a fake root and a viewport of a size, with the moves they report.
 *
 * @param {number} width - The viewport's width, in pixels.
 * @param {number} height - The viewport's height, in pixels.
 * @returns {any} - The gestures, the root and the moves.
 */
function gesturesOn(width = 400, height = 200) {
    const root = fakeRoot();
    const moves = [];
    const viewport = {x: 10, y: 20, width, height};
    const gestures = new PreviewGestures({root, viewport, onMove: move => moves.push(move)});
    return {gestures, root, moves, viewport};
}

/** A pointer event's fields at a point of the viewport.
 *
 * @param {number} x - From the viewport's left, in pixels.
 * @param {number} y - From the viewport's top, in pixels.
 * @param {number} [pointerId] - The pointer.
 * @returns {object} - The fields, in client coordinates.
 */
function at(x, y, pointerId = 1) {
    return {clientX: x + 10, clientY: y + 20, pointerId, button: 0};
}

/**
 * Is a number within a hair of another?
 *
 * @param {number} actual - The number.
 * @param {number} expected - What it should be.
 */
function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

describe("PreviewGestures", () => {
    test("a move within the drag threshold pans nothing, and its click goes through", () => {
        const {root, moves} = gesturesOn();
        root.fire("pointerdown", at(100, 100));
        root.fire("pointermove", at(100 + DRAG_THRESHOLD_PX - 1, 100));
        root.fire("pointerup", at(100 + DRAG_THRESHOLD_PX - 1, 100));
        const click = root.fire("click");
        assert.deepEqual(moves, []);
        assert.equal(click.propagationStopped, false);
        assert.equal(click.defaultPrevented, false);
    });

    test("a drag past the threshold pans by the whole distance, as a share of the size", () => {
        const {root, moves} = gesturesOn(400, 200);
        root.fire("pointerdown", at(200, 100));
        root.fire("pointermove", at(160, 100));
        root.fire("pointermove", at(100, 110));
        root.fire("pointerup", at(100, 110));
        assert.equal(moves.length, 2);
        const total = moves.reduce((sum, m) => ({x: sum.x + m.x, y: sum.y + m.y}), {x: 0, y: 0});
        near(total.x, -100 / 400);
        near(total.y, 10 / 200);
        for (const move of moves) {
            assert.equal(move.zoom, 1);
        }
    });

    test("the same drag on a viewport twice as wide is half the share", () => {
        const small = gesturesOn(400, 200);
        const large = gesturesOn(800, 200);
        for (const {root} of [small, large]) {
            root.fire("pointerdown", at(200, 100));
            root.fire("pointermove", at(100, 100));
        }
        near(small.moves[0].x, -0.25);
        near(large.moves[0].x, -0.125);
    });

    test("the click that ends a drag is swallowed before it reaches a link, once", () => {
        const {root} = gesturesOn();
        assert.equal(root.listeners.get("click").options, true);
        root.fire("pointerdown", at(200, 100));
        root.fire("pointermove", at(100, 100));
        root.fire("pointerup", at(100, 100));
        const click = root.fire("click");
        assert.equal(click.propagationStopped, true);
        assert.equal(click.defaultPrevented, true);
        root.fire("pointerdown", at(100, 100));
        root.fire("pointerup", at(100, 100));
        assert.equal(root.fire("click").propagationStopped, false);
    });

    test("the wheel zooms one step about the pointer, in and out", () => {
        const {root, moves} = gesturesOn(400, 200);
        const up = root.fire("wheel", {...at(100, 50), deltaY: -100});
        root.fire("wheel", {...at(100, 50), deltaY: 100});
        assert.equal(up.defaultPrevented, true);
        assert.deepEqual(moves, [
            {x: 0, y: 0, zoom: SCALE_FACTOR, atX: 0.25, atY: 0.25},
            {x: 0, y: 0, zoom: 1 / SCALE_FACTOR, atX: 0.25, atY: 0.25}
        ]);
    });

    test("a wheel with Shift held, or that turns nowhere, does nothing", () => {
        const {root, moves} = gesturesOn();
        root.fire("wheel", {...at(100, 50), deltaY: -100, shiftKey: true});
        root.fire("wheel", {...at(100, 50), deltaY: 0});
        assert.deepEqual(moves, []);
    });

    test("two pointers spreading apart zoom about their middle", () => {
        const {root, moves} = gesturesOn(400, 200);
        root.fire("pointerdown", at(180, 100, 1));
        root.fire("pointerdown", at(220, 100, 2));
        root.fire("pointermove", at(140, 100, 1));
        assert.equal(moves.length, 1);
        const [pinch] = moves;
        // The fingers were 40 px apart about x = 200, and are now 80 px apart about x = 180.
        near(pinch.zoom, 80 / 40);
        near(pinch.atX, 200 / 400);
        near(pinch.atY, 100 / 200);
        near(pinch.x, (180 - 200) / 400);
        near(pinch.y, 0);
    });

    test("the root takes the class that keeps the browser's own touch gestures off", () => {
        const {root} = gesturesOn();
        assert.ok(root.classes.has("sozi-preview-gestures"));
    });

    test("dispose removes every listener and the class", () => {
        const {gestures, root} = gesturesOn();
        gestures.dispose();
        assert.equal(root.listeners.size, 0);
        assert.equal(root.classes.size, 0);
    });
});
