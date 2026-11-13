import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {canvasOf, readCanvas} from "../../../src/js/protocol/canvas.js";

const canvas = {viewBox: [0, 0, 800, 600], width: "800", height: "600"};

describe("protocol canvas", () => {
    test("readCanvas reads a canvas back unchanged", () => {
        assert.deepEqual(readCanvas(canvas), canvas);
        const inMm = {viewBox: [-10, 5.5, 210, 297], width: "210mm", height: "297.5mm"};
        assert.deepEqual(readCanvas(inMm), inMm);
    });

    test("readCanvas reads an absent or empty width and height as empty", () => {
        assert.deepEqual(readCanvas({viewBox: [0, 0, 8, 6]}), {
            viewBox: [0, 0, 8, 6],
            width: "",
            height: ""
        });
        assert.deepEqual(readCanvas({...canvas, width: ""}), {...canvas, width: ""});
    });

    test("readCanvas refuses a viewBox that is not four finite numbers with a size above 0", () => {
        for (const viewBox of [
            undefined,
            "0 0 800 600",
            [0, 0, 800],
            [0, 0, 800, 600, 1],
            [0, 0, "800", 600],
            [0, Infinity, 800, 600],
            [0, 0, NaN, 600],
            [0, 0, 0, 600],
            [0, 0, 800, -1]
        ]) {
            assert.equal(readCanvas({...canvas, viewBox}), null, String(viewBox));
        }
    });

    test("readCanvas refuses a width or a height that is not a length", () => {
        for (const bad of ["100%", "auto", "-5", "5em", " 5", 5, null, "1e3"]) {
            assert.equal(readCanvas({...canvas, width: bad}), null, `width ${bad}`);
            assert.equal(readCanvas({...canvas, height: bad}), null, `height ${bad}`);
        }
    });

    test("readCanvas refuses what is not an object", () => {
        for (const data of [null, "canvas", 3, []]) {
            assert.equal(readCanvas(data), null, String(data));
        }
    });

    test("canvasOf reads the attributes of an SVG root", () => {
        assert.deepEqual(canvasOf("0 0 800 600", "800", "600"), canvas);
        assert.deepEqual(canvasOf(" -1,2.5  10 20 ", null, null), {
            viewBox: [-1, 2.5, 10, 20],
            width: "",
            height: ""
        });
    });

    test("canvasOf drops a width or a height that is not a length, and keeps the viewBox", () => {
        assert.deepEqual(canvasOf("0 0 800 600", "100%", "100%"), {
            viewBox: [0, 0, 800, 600],
            width: "",
            height: ""
        });
    });

    test("canvasOf takes 0 0 width height from a root with no viewBox, in pixels only", () => {
        assert.deepEqual(canvasOf(null, "800", "600"), canvas);
        assert.deepEqual(canvasOf(null, "800px", "600px"), {
            viewBox: [0, 0, 800, 600],
            width: "800px",
            height: "600px"
        });
        assert.equal(canvasOf(null, "210mm", "297mm"), null);
        assert.equal(canvasOf(null, "800", null), null);
        assert.equal(canvasOf(null, null, null), null);
    });

    test("canvasOf gives null for a malformed viewBox", () => {
        assert.equal(canvasOf("0 0 800", "800", "600"), null);
        assert.equal(canvasOf("0 0 0 600", "800", "600"), null);
        assert.equal(canvasOf("a b c d", "800", "600"), null);
    });
});
