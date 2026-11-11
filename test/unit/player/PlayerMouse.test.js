import {test, describe, mock, afterEach} from "node:test";
import assert from "node:assert/strict";
import {PlayerMouse} from "../../../src/js/player/PlayerMouse.js";
import {PlayerControllerEvents} from "../../../src/js/player/playerControllerEvents.js";
import {DRAG_THRESHOLD_PX, SCALE_FACTOR, ROTATE_STEP} from "../../../src/js/player/controlSteps.js";
import {fakeRoot, mouseEvent, fakeMouseController, names} from "./fakeInput.js";

/** A mouse on a fake controller and a fake SVG root in a fake document.
 *
 * @param {object} [options] - See `fakeMouseController`.
 * @returns {any} - The mouse, the controller, the root and the document's root element.
 */
function mouseOn(options) {
    const controller = fakeMouseController(options);
    const root = fakeRoot();
    const mouse = new PlayerMouse(controller, root);
    return {mouse, controller, root, page: root.page};
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
        root.fire("mousemove", mouseEvent({clientX: 30, clientY: 40}));
        assert.deepEqual(controller.calls, [["updateClipCursor", 30, 40]]);
    });

    test("a left press starts following a drag on the page and signals the press", () => {
        const {root, page, controller} = mouseOn();
        const evt = root.fire("mousedown", mouseEvent({clientX: 30, clientY: 40}));
        assert.deepEqual(page.types(), ["mousemove", "mouseup"]);
        assert.deepEqual(controller.calls, [
            ["updateClipMode", 30, 40],
            ["emit:" + PlayerControllerEvents.mouseDown, 0]
        ]);
        assert.equal(evt.stopped && evt.prevented, true);
    });

    test("a second left press replaces the drag of the first", () => {
        const {root, page} = mouseOn();
        root.fire("mousedown", mouseEvent());
        root.fire("mousedown", mouseEvent());
        assert.equal(page.count(), 2);
    });

    test("a press and release within the drag threshold is a click on the next frame", () => {
        const {root, page, controller} = mouseOn();
        root.fire("mousedown", mouseEvent({clientX: 100, clientY: 100}));
        const at = {clientX: 100 + DRAG_THRESHOLD_PX, clientY: 100};
        page.fire("mousemove", mouseEvent(at));
        page.fire("mouseup", mouseEvent(at));
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
            root.fire("mousedown", mouseEvent());
            page.fire("mouseup", mouseEvent());
            assert.ok(!names(controller).includes("moveToNext"), JSON.stringify(options));
            assert.ok(names(controller).includes("emit:" + PlayerControllerEvents.click));
        }
    });

    test("a right press is a click on the previous frame, with no drag", () => {
        const {root, page, controller} = mouseOn();
        root.fire("mousedown", mouseEvent({button: 2}));
        assert.equal(page.count(), 0);
        root.fire("contextmenu", mouseEvent({button: 2}));
        assert.deepEqual(names(controller), [
            "emit:" + PlayerControllerEvents.mouseDown,
            "moveToPrevious",
            "emit:" + PlayerControllerEvents.click
        ]);
    });

    test("the wheel zooms about the pointer and signals one change after it stops", () => {
        mock.timers.enable({apis: ["setTimeout"]});
        const {root, controller} = mouseOn();
        root.fire("wheel", mouseEvent({deltaY: -1, clientX: 110, clientY: 70}));
        root.fire("wheel", mouseEvent({deltaY: 1, clientX: 110, clientY: 70}));
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
        root.fire("wheel", mouseEvent({deltaY: -1, shiftKey: true}));
        root.fire("wheel", mouseEvent({deltaY: 1, shiftKey: true}));
        assert.deepEqual(controller.calls, [
            ["rotate", ROTATE_STEP],
            ["rotate", -ROTATE_STEP]
        ]);
    });

    test("the legacy wheel events turn the same way", () => {
        const {root, controller} = mouseOn();
        root.fire("wheel", mouseEvent({wheelDelta: 120}));
        root.fire("wheel", mouseEvent({detail: 3}));
        assert.deepEqual(names(controller), ["zoom", "zoom"]);
        assert.equal(controller.calls[0][1], SCALE_FACTOR);
        assert.equal(controller.calls[1][1], 1 / SCALE_FACTOR);
    });

    test("with mouse zoom off, the wheel changes nothing and signals nothing", () => {
        mock.timers.enable({apis: ["setTimeout"]});
        const {root, controller} = mouseOn({enableMouseZoom: false});
        const evt = root.fire("wheel", mouseEvent({deltaY: -1}));
        mock.timers.tick(1000);
        assert.deepEqual(controller.calls, []);
        assert.equal(evt.prevented, true);
    });

    test("dispose during a drag and a wheel leaves no listener and no timer behind", () => {
        mock.timers.enable({apis: ["setTimeout"]});
        const {mouse, root, page, controller} = mouseOn();
        root.fire("wheel", mouseEvent({deltaY: -1}));
        root.fire("mousedown", mouseEvent({clientX: 100, clientY: 100}));
        page.fire("mousemove", mouseEvent({clientX: 120, clientY: 100}));
        mouse.dispose();
        assert.equal(root.count(), 0);
        assert.equal(page.count(), 0);
        const before = controller.calls.length;
        mock.timers.tick(1000);
        assert.equal(controller.calls.length, before);
    });
});
