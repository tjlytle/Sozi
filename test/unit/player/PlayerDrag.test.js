import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {PlayerDrag} from "../../../src/js/player/PlayerDrag.js";
import {PlayerControllerEvents} from "../../../src/js/player/playerControllerEvents.js";
import {DRAG_THRESHOLD_PX} from "../../../src/js/player/controlSteps.js";
import {fakeTarget, mouseEvent, fakeMouseController, names} from "./fakeInput.js";

/** A drag started by a left press at a point, on a fake controller and a fake page.
 *
 * @param {[number, number]} press - Where the button was pressed, in client coordinates.
 * @param {object} [options] - See `fakeMouseController`.
 * @returns {any} - The drag, the controller, the page and the clicks it reported.
 */
function dragFrom([x, y], options) {
    const controller = fakeMouseController(options);
    const page = fakeTarget();
    const clicks = [];
    const press = mouseEvent({clientX: x, clientY: y});
    const drag = new PlayerDrag(controller, page, press, evt => clicks.push(evt));
    return {drag, controller, page, clicks};
}

/** Move through points, in client coordinates, and release at the last one.
 *
 * @param {any} page - The fake page.
 * @param {Array<[number, number]>} points - The moves.
 * @param {object} [fields] - Modifier keys held for the moves.
 * @returns {any} - The release event.
 */
function moveAndRelease(page, points, fields = {}) {
    for (const [x, y] of points) {
        page.fire("mousemove", mouseEvent({clientX: x, clientY: y, ...fields}));
    }
    const [x, y] = points[points.length - 1];
    return page.fire("mouseup", mouseEvent({clientX: x, clientY: y}));
}

/** The calls of one action, with their arguments.
 *
 * @param {any} controller - The fake controller.
 * @param {string} name - The action.
 * @returns {Array<Array<any>>} - The calls.
 */
function callsOf(controller, name) {
    return controller.calls.filter(([called]) => called === name);
}

/** Is a number within a hair of another?
 *
 * @param {number} actual - The number.
 * @param {number} expected - What it should be.
 */
function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

describe("PlayerDrag", () => {
    test("follows the mouse on the page from the press", () => {
        const {page} = dragFrom([100, 100]);
        assert.deepEqual(page.types(), ["mousemove", "mouseup"]);
    });

    test("a move no longer than the drag threshold ends as a click", () => {
        const {controller, page, clicks} = dragFrom([100, 100]);
        const release = moveAndRelease(page, [[100 + DRAG_THRESHOLD_PX, 100]]);
        assert.deepEqual(clicks, [release]);
        assert.deepEqual(controller.calls, []);
        assert.equal(page.count(), 0);
        assert.equal(release.stopped && release.prevented, true);
    });

    test("a drag past the threshold pans and signals a local change at its end", () => {
        const {controller, page, clicks} = dragFrom([100, 100]);
        moveAndRelease(page, [
            [110, 100],
            [130, 105]
        ]);
        assert.deepEqual(controller.calls, [
            ["pause"],
            ["emit:" + PlayerControllerEvents.dragStart],
            ["translate", 0, 0],
            ["translate", 20, 5],
            ["emit:" + PlayerControllerEvents.dragEnd],
            ["emit:" + PlayerControllerEvents.localViewportChange]
        ]);
        assert.deepEqual(clicks, []);
        assert.equal(page.count(), 0);
    });

    test("Ctrl keeps a pan on its main axis", () => {
        const {controller, page} = dragFrom([100, 100]);
        moveAndRelease(
            page,
            [
                [110, 100],
                [140, 110]
            ],
            {ctrlKey: true}
        );
        assert.deepEqual(callsOf(controller, "translate"), [
            ["translate", 0, 0],
            ["translate", 30, 0]
        ]);
    });

    test("with mouse translation off, a drag pans nothing and signals no change", () => {
        const {controller, page} = dragFrom([100, 100], {enableMouseTranslation: false});
        moveAndRelease(page, [
            [120, 100],
            [140, 100]
        ]);
        assert.deepEqual(names(controller), [
            "emit:" + PlayerControllerEvents.dragStart,
            "emit:" + PlayerControllerEvents.dragEnd
        ]);
    });

    test("in the editor, a drag pans even with mouse translation off", () => {
        const {controller, page} = dragFrom([100, 100], {
            editMode: true,
            enableMouseTranslation: false
        });
        moveAndRelease(page, [
            [120, 100],
            [140, 100]
        ]);
        assert.deepEqual(callsOf(controller, "translate"), [
            ["translate", 0, 0],
            ["translate", 20, 0]
        ]);
    });

    test("Alt and a drag zoom about the centre by the change in distance from it", () => {
        const {controller, page} = dragFrom([310, 120]);
        moveAndRelease(
            page,
            [
                [320, 120],
                [370, 120]
            ],
            {altKey: true}
        );
        assert.deepEqual(callsOf(controller, "zoom"), [
            ["zoom", 1, 200, 100],
            ["zoom", 160 / 110, 200, 100]
        ]);
        assert.ok(names(controller).includes("emit:" + PlayerControllerEvents.localViewportChange));
    });

    test("Shift and a drag rotate by the angle swept about the centre", () => {
        const {controller, page} = dragFrom([310, 120]);
        moveAndRelease(
            page,
            [
                [310, 130],
                [210, 220]
            ],
            {shiftKey: true}
        );
        const turns = callsOf(controller, "rotate");
        assert.equal(turns.length, 2);
        near(turns[0][1], 0);
        near(turns[1][1], (180 * Math.atan2(10, 100)) / Math.PI - 90);
    });

    test("Shift, Ctrl and a drag rotate in steps of ten degrees from the start", () => {
        const {controller, page} = dragFrom([310, 120]);
        moveAndRelease(
            page,
            [
                [310, 130],
                [210, 220]
            ],
            {shiftKey: true, ctrlKey: true}
        );
        // The drag starts at (310, 130), about 5.7 degrees: steps count from there.
        const turns = callsOf(controller, "rotate");
        assert.equal(turns.length, 2);
        near(turns[0][1], 0);
        near(turns[1][1], -80);
    });

    test("in clip mode, a drag clips from where it started", () => {
        const {controller, page} = dragFrom([100, 100], {dragMode: "clip"});
        moveAndRelease(page, [
            [110, 100],
            [130, 120]
        ]);
        assert.deepEqual(callsOf(controller, "clipByMode"), [
            ["clipByMode", 90, 80, 90, 80, 10, 0],
            ["clipByMode", 90, 80, 100, 80, 20, 20]
        ]);
    });

    test("the release of another button is a click, and the drag goes on", () => {
        const {page, clicks} = dragFrom([100, 100]);
        const release = page.fire("mouseup", mouseEvent({button: 2}));
        assert.deepEqual(clicks, [release]);
        assert.deepEqual(page.types(), ["mousemove", "mouseup"]);
    });

    test("dispose stops following the mouse", () => {
        const {drag, controller, page} = dragFrom([100, 100]);
        page.fire("mousemove", mouseEvent({clientX: 120, clientY: 100}));
        drag.dispose();
        assert.equal(page.count(), 0);
        const before = controller.calls.length;
        page.fire("mousemove", mouseEvent({clientX: 140, clientY: 100}));
        assert.equal(controller.calls.length, before);
    });
});
