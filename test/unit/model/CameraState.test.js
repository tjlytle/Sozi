import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {CameraState} from "../../../src/js/model/CameraState.js";
import {svgRootStub, svgElementStub} from "../support/stubs.js";

describe("CameraState", () => {
    test("a camera made from the root fits the bounding box of the content", () => {
        const camera = new CameraState(svgRootStub({x: 10, y: 20, width: 300, height: 100}));
        assert.equal(camera.cx, 160);
        assert.equal(camera.cy, 70);
        assert.equal(camera.width, 300);
        assert.equal(camera.height, 100);
        assert.equal(camera.angle, 0);
        assert.equal(camera.opacity, 1);
        assert.equal(camera.clipped, false);
    });

    test("width and height are at least 1; angle is normalized to [-180, 180)", () => {
        const camera = new CameraState(svgRootStub({x: 0, y: 0, width: 10, height: 10}));
        camera.width = 0;
        camera.height = NaN;
        assert.equal(camera.width, 1);
        assert.equal(camera.height, 1);
        camera.angle = 190;
        assert.equal(camera.angle, -170);
        camera.angle = -190;
        assert.equal(camera.angle, 170);
        camera.angle = NaN;
        assert.equal(camera.angle, 0);
    });

    test("copy makes an independent camera", () => {
        const original = new CameraState(svgRootStub({x: 0, y: 0, width: 100, height: 50}));
        const copy = new CameraState(original);
        assert.deepEqual(copy.toStorable(), original.toStorable());
        assert.equal(copy.svgRoot, original.svgRoot);
        copy.cx = 999;
        copy.clipped = true;
        assert.equal(original.cx, 50);
        assert.equal(original.clipped, false);
    });

    test("toStorable and fromStorable round trip", () => {
        const root = svgRootStub({x: 0, y: 0, width: 100, height: 50});
        const source = new CameraState(root);
        source.cx = 12;
        source.cy = 34;
        source.width = 56;
        source.height = 78;
        source.opacity = 0.5;
        source.angle = 45;
        source.clipped = true;
        source.clipXOffset = 3;
        source.clipYOffset = 4;
        source.clipWidthFactor = 0.5;
        source.clipHeightFactor = 0.25;

        const target = new CameraState(root);
        target.fromStorable(JSON.parse(JSON.stringify(source.toStorable())));
        assert.deepEqual(target.toStorable(), source.toStorable());
        assert.deepEqual(target.toMinimalStorable(), source.toStorable());
    });

    test("fromStorable copies only the keys present", () => {
        const camera = new CameraState(svgRootStub({x: 0, y: 0, width: 100, height: 50}));
        camera.fromStorable({cx: 7});
        assert.equal(camera.cx, 7);
        assert.equal(camera.cy, 25);
    });

    test("setAtElement centres the camera on the element, with offsets applied", () => {
        const root = svgRootStub({x: 0, y: 0, width: 1000, height: 1000});
        const camera = new CameraState(root);
        camera.setAtElement(svgElementStub({x: 100, y: 200, width: 40, height: 20}, root));
        assert.equal(camera.cx, 120);
        assert.equal(camera.cy, 210);
        assert.equal(camera.width, 40);
        assert.equal(camera.height, 20);
        assert.equal(camera.angle, 0);

        camera.setAtElement(
            svgElementStub({x: 100, y: 200, width: 40, height: 20}, root),
            5,
            -5,
            2,
            3,
            90
        );
        assert.equal(camera.cx, 125);
        assert.equal(camera.cy, 205);
        assert.equal(camera.width, 80);
        assert.equal(camera.height, 60);
        assert.equal(camera.angle, 90);
    });

    test("offsetFromElement and applyOffset", () => {
        const root = svgRootStub({x: 0, y: 0, width: 1000, height: 1000});
        const element = svgElementStub({x: 100, y: 200, width: 40, height: 20}, root);
        const camera = new CameraState(root);
        camera.setAtElement(element, 10, 20, 2, 4, 30);
        const offset = camera.offsetFromElement(element);
        assert.deepEqual(offset, {
            deltaX: 10,
            deltaY: 20,
            widthFactor: 2,
            heightFactor: 4,
            deltaAngle: 30
        });
        camera.applyOffset(offset);
        assert.equal(camera.cx, 120);
        assert.equal(camera.width, 40);
        assert.equal(camera.angle, 0);
    });

    test("resetClipping restores the default clipping rectangle", () => {
        const camera = new CameraState(svgRootStub({x: 0, y: 0, width: 100, height: 50}));
        camera.clipXOffset = 5;
        camera.clipYOffset = 6;
        camera.clipWidthFactor = 0.3;
        camera.clipHeightFactor = 0.4;
        camera.clipped = true;
        camera.resetClipping();
        assert.equal(camera.clipXOffset, 0);
        assert.equal(camera.clipYOffset, 0);
        assert.equal(camera.clipWidthFactor, 1);
        assert.equal(camera.clipHeightFactor, 1);
        assert.equal(camera.clipped, true);
    });
});
