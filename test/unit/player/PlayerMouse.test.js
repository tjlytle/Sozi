import {test, describe, mock, afterEach} from "node:test";
import assert from "node:assert/strict";
import {PlayerMouse} from "../../../src/js/player/PlayerMouse.js";
import {PlayerControllerEvents} from "../../../src/js/player/PlayerController.js";
import {DRAG_THRESHOLD_PX, SCALE_FACTOR, ROTATE_STEP} from "../../../src/js/player/controlSteps.js";

/** Stand-in for an element: it keeps its listeners.
 *
 * @returns {any} - The fake; `fire(type, fields)` dispatches an event to it.
 */
function fakeTarget() {
    const listeners = new Map();
    return {
        listeners,
        addEventListener(type, listener) {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        removeEventListener(type, listener) {
            listeners.set(
                type,
                (listeners.get(type) ?? []).filter(l => l !== listener)
            );
        },
        count() {
            return [...listeners.values()].reduce((sum, list) => sum + list.length, 0);
        },
        types() {
            return [...listeners.keys()].filter(type => listeners.get(type).length).sort();
        },
        fire(type, fields = {}) {
            const evt = {
                type,
                button: 0,
                clientX: 0,
                clientY: 0,
                altKey: false,
                shiftKey: false,
                ctrlKey: false,
                prevented: false,
                stopped: false,
                preventDefault() {
                    this.prevented = true;
                },
                stopPropagation() {
                    this.stopped = true;
                },
                ...fields
            };
            for (const listener of listeners.get(type) ?? []) {
                listener(evt);
            }
            return evt;
        }
    };
}

/** Stand-in for a controller: it records its actions and the events it emits.
 *
 * @param {object} [options] - `editMode`, `dragMode` and the presentation's mouse settings.
 * @returns {any} - The fake; `calls` lists each action and event with its arguments.
 */
function fakeController(options = {}) {
    const {editMode = false, dragMode = "translate", ...settings} = /** @type {any} */ (options);
    const calls = [];
    const record =
        name =>
        (...args) =>
            calls.push([name, ...args]);
    return {
        calls,
        editMode,
        player: {pause: record("pause")},
        presentation: {
            enableMouseTranslation: true,
            enableMouseZoom: true,
            enableMouseRotation: true,
            enableMouseNavigation: true,
            ...settings
        },
        viewport: {
            x: 10,
            y: 20,
            width: 400,
            height: 200,
            dragMode,
            updateClipCursor: record("updateClipCursor"),
            updateClipMode: record("updateClipMode"),
            clipByMode: record("clipByMode")
        },
        zoom: record("zoom"),
        rotate: record("rotate"),
        translate: record("translate"),
        moveToNext: record("moveToNext"),
        moveToPrevious: record("moveToPrevious"),
        emit: (name, ...args) => calls.push(["emit:" + name, ...args])
    };
}

/** A mouse on a fake controller and a fake SVG root in a fake document.
 *
 * @param {object} [options] - See `fakeController`.
 * @returns {any} - The mouse, the controller, the root and the document's root element.
 */
function mouseOn(options) {
    const controller = fakeController(options);
    const page = fakeTarget();
    const root = fakeTarget();
    root.ownerDocument = {
        documentElement: page,
        createElement: () => ({onwheel: null})
    };
    const mouse = new PlayerMouse(controller, root);
    return {mouse, controller, root, page};
}

/** The names of the calls a controller recorded, without their arguments.
 *
 * @param {any} controller - The fake controller.
 * @returns {Array<string>} - The names.
 */
function names(controller) {
    return controller.calls.map(([name]) => name);
}

/** Drag through points, in client coordinates, and release.
 *
 * @param {any} root - The fake SVG root.
 * @param {any} page - The fake document root element.
 * @param {Array<[number, number]>} points - The press, the moves and the release.
 * @param {object} [fields] - Modifier keys held for the moves.
 */
function drag(root, page, points, fields = {}) {
    const [[x0, y0], ...moves] = points;
    root.fire("mousedown", {clientX: x0, clientY: y0});
    for (const [x, y] of moves) {
        page.fire("mousemove", {clientX: x, clientY: y, ...fields});
    }
    const [xn, yn] = points[points.length - 1];
    page.fire("mouseup", {clientX: xn, clientY: yn});
}

/** Is a number within a hair of another?
 *
 * @param {number} actual - The number.
 * @param {number} expected - What it should be.
 */
function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

afterEach(() => mock.timers.reset());

describe("PlayerMouse", () => {
    test("listens on the SVG root for presses, moves, the context menu and the wheel", () => {
        const {root, page} = mouseOn();
        assert.deepEqual(root.types(), ["contextmenu", "mousedown", "mousemove", "wheel"]);
        assert.equal(page.count(), 0);
    });

    test("a move over the root updates the clip cursor", () => {
        const {root, controller} = mouseOn();
        root.fire("mousemove", {clientX: 30, clientY: 40});
        assert.deepEqual(controller.calls, [["updateClipCursor", 30, 40]]);
    });

    test("a left press listens for the drag on the page and signals the press", () => {
        const {root, page, controller} = mouseOn();
        const evt = root.fire("mousedown", {clientX: 30, clientY: 40});
        assert.deepEqual(page.types(), ["mousemove", "mouseup"]);
        assert.deepEqual(controller.calls, [
            ["updateClipMode", 30, 40],
            ["emit:" + PlayerControllerEvents.mouseDown, 0]
        ]);
        assert.equal(evt.stopped && evt.prevented, true);
    });

    test("a move shorter than the drag threshold is a click on the next frame", () => {
        const {root, page, controller} = mouseOn();
        drag(root, page, [
            [100, 100],
            [100 + DRAG_THRESHOLD_PX, 100]
        ]);
        assert.deepEqual(names(controller), [
            "updateClipMode",
            "emit:" + PlayerControllerEvents.mouseDown,
            "moveToNext",
            "emit:" + PlayerControllerEvents.click
        ]);
        assert.equal(page.count(), 0);
    });

    test("in the editor, or with mouse navigation off, a click moves nothing", () => {
        for (const options of [{editMode: true}, {enableMouseNavigation: false}]) {
            const {root, page, controller} = mouseOn(options);
            drag(root, page, [[100, 100]]);
            assert.ok(!names(controller).includes("moveToNext"), JSON.stringify(options));
            assert.ok(names(controller).includes("emit:" + PlayerControllerEvents.click));
        }
    });

    test("a drag past the threshold pans and signals a local change at its end", () => {
        const {root, page, controller} = mouseOn();
        drag(root, page, [
            [100, 100],
            [110, 100],
            [130, 105]
        ]);
        assert.deepEqual(controller.calls.slice(2), [
            ["pause"],
            ["emit:" + PlayerControllerEvents.dragStart],
            ["translate", 0, 0],
            ["translate", 20, 5],
            ["emit:" + PlayerControllerEvents.dragEnd],
            ["emit:" + PlayerControllerEvents.localViewportChange]
        ]);
        assert.equal(page.count(), 0);
    });

    test("Ctrl keeps a pan on its main axis", () => {
        const {root, page, controller} = mouseOn();
        drag(
            root,
            page,
            [
                [100, 100],
                [110, 100],
                [140, 110]
            ],
            {ctrlKey: true}
        );
        const pans = controller.calls.filter(([name]) => name === "translate");
        assert.deepEqual(pans, [
            ["translate", 0, 0],
            ["translate", 30, 0]
        ]);
    });

    test("with mouse translation off, a drag pans nothing and signals no change", () => {
        const {root, page, controller} = mouseOn({enableMouseTranslation: false});
        drag(root, page, [
            [100, 100],
            [120, 100],
            [140, 100]
        ]);
        assert.deepEqual(names(controller).slice(2), [
            "emit:" + PlayerControllerEvents.dragStart,
            "emit:" + PlayerControllerEvents.dragEnd
        ]);
    });

    test("Alt and a drag zoom about the centre by the change in distance from it", () => {
        const {root, page, controller} = mouseOn();
        // The viewport's centre is at (210, 120) in client coordinates.
        drag(
            root,
            page,
            [
                [310, 120],
                [320, 120],
                [370, 120]
            ],
            {altKey: true}
        );
        const zooms = controller.calls.filter(([name]) => name === "zoom");
        assert.deepEqual(zooms, [
            ["zoom", 1, 200, 100],
            ["zoom", 160 / 110, 200, 100]
        ]);
        assert.ok(names(controller).includes("emit:" + PlayerControllerEvents.localViewportChange));
    });

    test("Shift and a drag rotate by the angle swept about the centre", () => {
        const {root, page, controller} = mouseOn();
        drag(
            root,
            page,
            [
                [310, 120],
                [310, 130],
                [210, 220]
            ],
            {shiftKey: true}
        );
        const turns = controller.calls.filter(([name]) => name === "rotate");
        assert.equal(turns.length, 2);
        near(turns[0][1], 0);
        near(turns[1][1], (180 * Math.atan2(10, 100)) / Math.PI - 90);
    });

    test("in clip mode, a drag clips from where it started", () => {
        const {root, page, controller} = mouseOn({dragMode: "clip"});
        drag(root, page, [
            [100, 100],
            [110, 100],
            [130, 120]
        ]);
        const clips = controller.calls.filter(([name]) => name === "clipByMode");
        assert.deepEqual(clips, [
            ["clipByMode", 90, 80, 90, 80, 10, 0],
            ["clipByMode", 90, 80, 100, 80, 20, 20]
        ]);
    });

    test("a right press is a click on the previous frame, with no drag", () => {
        const {root, page, controller} = mouseOn();
        root.fire("mousedown", {button: 2});
        assert.equal(page.count(), 0);
        root.fire("contextmenu", {button: 2});
        assert.deepEqual(names(controller), [
            "emit:" + PlayerControllerEvents.mouseDown,
            "moveToPrevious",
            "emit:" + PlayerControllerEvents.click
        ]);
    });

    test("the wheel zooms about the pointer and signals one change after it stops", () => {
        mock.timers.enable({apis: ["setTimeout"]});
        const {root, controller} = mouseOn();
        root.fire("wheel", {deltaY: -1, clientX: 110, clientY: 70});
        root.fire("wheel", {deltaY: 1, clientX: 110, clientY: 70});
        assert.deepEqual(controller.calls, [
            ["zoom", SCALE_FACTOR, 100, 50],
            ["zoom", 1 / SCALE_FACTOR, 100, 50]
        ]);
        mock.timers.tick(199);
        assert.equal(controller.calls.length, 2);
        mock.timers.tick(1);
        assert.deepEqual(controller.calls[2], [
            "emit:" + PlayerControllerEvents.localViewportChange
        ]);
        mock.timers.tick(1000);
        assert.equal(controller.calls.length, 3);
    });

    test("Shift and the wheel rotate by one step", () => {
        const {root, controller} = mouseOn();
        root.fire("wheel", {deltaY: -1, shiftKey: true});
        root.fire("wheel", {deltaY: 1, shiftKey: true});
        assert.deepEqual(controller.calls, [
            ["rotate", ROTATE_STEP],
            ["rotate", -ROTATE_STEP]
        ]);
    });

    test("with mouse zoom off, the wheel changes nothing and signals nothing", () => {
        mock.timers.enable({apis: ["setTimeout"]});
        const {root, controller} = mouseOn({enableMouseZoom: false});
        const evt = root.fire("wheel", {deltaY: -1});
        mock.timers.tick(1000);
        assert.deepEqual(controller.calls, []);
        assert.equal(evt.prevented, true);
    });

    test("dispose during a drag and a wheel leaves no listener and no timer behind", () => {
        mock.timers.enable({apis: ["setTimeout"]});
        const {mouse, root, page, controller} = mouseOn();
        root.fire("wheel", {deltaY: -1});
        root.fire("mousedown", {clientX: 100, clientY: 100});
        page.fire("mousemove", {clientX: 120, clientY: 100});
        mouse.dispose();
        assert.equal(root.count(), 0);
        assert.equal(page.count(), 0);
        const before = controller.calls.length;
        mock.timers.tick(1000);
        assert.equal(controller.calls.length, before);
    });
});
