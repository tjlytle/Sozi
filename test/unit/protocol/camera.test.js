import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    ON_FRAME,
    cameraMessage,
    cameraMoveMessage,
    cameraResetMessage,
    composeView,
    readCamera,
    readCameraMove,
    readCameraReset,
    readCameraView
} from "../../../src/js/protocol/camera.js";

const move = {x: -0.1, y: 0.2, zoom: 2, atX: 0.25, atY: 0.75};
const view = {offFrame: true, zoom: 1.5, x: 0.1, y: -0.2};

describe("protocol camera", () => {
    test("each builder names its message", () => {
        assert.deepEqual(cameraMoveMessage(move), {name: "cameraMove", ...move});
        assert.deepEqual(cameraResetMessage(), {name: "cameraReset"});
        assert.deepEqual(cameraMessage(view), {name: "camera", ...view});
    });

    test("every built message reads back unchanged", () => {
        assert.deepEqual(readCameraMove(cameraMoveMessage(move)), cameraMoveMessage(move));
        assert.deepEqual(readCameraReset(), cameraResetMessage());
        assert.deepEqual(readCamera(cameraMessage(view)), cameraMessage(view));
        assert.deepEqual(readCamera(cameraMessage(ON_FRAME)), cameraMessage(ON_FRAME));
    });

    test("a move needs finite numbers and a zoom above zero", () => {
        for (const bad of [
            {zoom: 0},
            {zoom: -1},
            {x: Infinity},
            {y: NaN},
            {atX: "0"},
            {atY: undefined}
        ]) {
            assert.equal(readCameraMove({...cameraMoveMessage(move), ...bad}), null);
        }
    });

    test("a view needs a boolean offFrame, a zoom above zero and finite offsets", () => {
        for (const bad of [{offFrame: 1}, {zoom: 0}, {x: NaN}, {y: null}]) {
            assert.equal(readCameraView({...view, ...bad}), null);
        }
        assert.equal(readCameraView(null), null);
        assert.deepEqual(readCameraView({...view, extra: 1}), view);
    });

    test("composeView zooms about the point, then pans", () => {
        // The frame's top-left corner shows at (x, y); zooming by 2 about (0.25, 0.75) puts it
        // at 2·(x − 0.25) + 0.25, then the pan adds its own offset.
        assert.deepEqual(composeView({offFrame: false, zoom: 1, x: 0, y: 0}, move), {
            offFrame: true,
            zoom: 2,
            x: 2 * (0 - 0.25) + 0.25 - 0.1,
            y: 2 * (0 - 0.75) + 0.75 + 0.2
        });
    });

    test("composeView keeps the point it zooms about where it was", () => {
        const at = {atX: 0.3, atY: 0.6};
        const after = composeView(view, {x: 0, y: 0, zoom: 3, ...at});
        // The frame point under (0.3, 0.6) before the zoom is still under it after.
        const before = {px: (at.atX - view.x) / view.zoom, py: (at.atY - view.y) / view.zoom};
        assert.ok(Math.abs(after.zoom * before.px + after.x - at.atX) < 1e-12);
        assert.ok(Math.abs(after.zoom * before.py + after.y - at.atY) < 1e-12);
    });

    test("composeView with a move that moves nothing leaves the view as it was", () => {
        const identity = {x: 0, y: 0, zoom: 1, atX: 0.5, atY: 0.5};
        assert.deepEqual(composeView(ON_FRAME, identity), ON_FRAME);
        assert.deepEqual(composeView(view, identity), view);
    });
});
