import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {viewportMessage, readViewport, postViewport} from "../../../src/js/protocol/viewport.js";

const fakeWindow = {innerWidth: 1200, innerHeight: 400, devicePixelRatio: 2};

describe("viewport message", () => {
    test("is built from a window's inner size and pixel ratio", () => {
        assert.deepEqual(viewportMessage(fakeWindow), {
            name: "viewport",
            width: 1200,
            height: 400,
            pixelRatio: 2
        });
    });

    test("reads back to its size and pixel ratio", () => {
        assert.deepEqual(readViewport(viewportMessage(fakeWindow)), {
            width: 1200,
            height: 400,
            pixelRatio: 2
        });
    });

    test("is refused with a zero, negative, NaN, infinite or missing field", () => {
        const good = viewportMessage(fakeWindow);
        for (const field of ["width", "height", "pixelRatio"]) {
            for (const bad of [0, -1, NaN, Infinity, "400", undefined]) {
                assert.equal(readViewport({...good, [field]: bad}), null, `${field}: ${bad}`);
            }
        }
    });

    test("is refused under another name or when it is not an object", () => {
        assert.equal(readViewport({...viewportMessage(fakeWindow), name: "frameChange"}), null);
        assert.equal(readViewport(null), null);
        assert.equal(readViewport("viewport"), null);
    });

    test("is posted once to the target", () => {
        const posted = [];
        const target = {postMessage: (...args) => posted.push(args)};
        postViewport(target, fakeWindow);
        assert.deepEqual(posted, [[viewportMessage(fakeWindow), "*"]]);
    });
});
