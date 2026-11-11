import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {fakeController, fakePlayer} from "./fakeDeck.js";
import {CameraTracker} from "../../../src/js/player/CameraTracker.js";
import {PlayerControllerEvents} from "../../../src/js/player/PlayerController.js";
import {ON_FRAME, cameraMessage, composeView} from "../../../src/js/protocol/camera.js";

/** A tracker on a fake controller, with the messages it reports.
 *
 * @returns {{tracker: CameraTracker, controller: any, reported: any[]}} - The tracker, its
 *   controller and the list of messages reported.
 */
function trackedController() {
    const controller = fakeController(fakePlayer());
    const reported = [];
    const tracker = new CameraTracker({controller, report: message => reported.push(message)});
    return {tracker, controller, reported};
}

describe("CameraTracker", () => {
    test("each zoom and pan of the display, its own mouse included, is reported as camera", () => {
        const {controller, reported} = trackedController();
        controller.zoom(2, 300, 300);
        controller.translate(-120, 40);
        const zoomed = composeView(ON_FRAME, {x: 0, y: 0, zoom: 2, atX: 0.25, atY: 0.75});
        const panned = composeView(zoomed, {x: -0.1, y: 0.1, zoom: 1, atX: 0, atY: 0});
        assert.deepEqual(reported, [cameraMessage(zoomed), cameraMessage(panned)]);
    });

    test("a rotation marks the camera off its frame and leaves the view as it was", () => {
        const {controller, reported} = trackedController();
        controller.emit(PlayerControllerEvents.rotate, 5);
        assert.deepEqual(reported, [cameraMessage({...ON_FRAME, offFrame: true})]);
    });

    test("its view starts on the frame and follows each pan", () => {
        const {tracker, controller} = trackedController();
        assert.deepEqual(tracker.view, ON_FRAME);
        controller.translate(-120, 0);
        assert.deepEqual(tracker.view, {offFrame: true, zoom: 1, x: -0.1, y: 0});
    });

    test("reset after a pan reports the view back on its frame, once", () => {
        const {tracker, controller, reported} = trackedController();
        controller.translate(-120, 0);
        reported.length = 0;
        tracker.reset();
        tracker.reset();
        assert.deepEqual(reported, [cameraMessage(ON_FRAME)]);
        assert.deepEqual(tracker.view, ON_FRAME);
    });

    test("reset on the frame reports nothing", () => {
        const {tracker, reported} = trackedController();
        tracker.reset();
        assert.deepEqual(reported, []);
    });

    test("dispose removes every listener it added to the controller", () => {
        const {tracker, controller, reported} = trackedController();
        tracker.dispose();
        for (const name of ["zoom", "translate", "rotate"]) {
            assert.equal(controller.listenerCount(PlayerControllerEvents[name]), 0, name);
        }
        controller.translate(-120, 0);
        assert.deepEqual(reported, []);
    });
});
