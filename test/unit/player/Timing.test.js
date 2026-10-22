import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    linear,
    ease,
    easeIn,
    easeOut,
    easeInOut,
    stepStart,
    stepEnd,
    stepMiddle,
    makeBezier,
    makeSteps
} from "../../../src/js/player/Timing.js";

describe("timing functions", () => {
    test("every curve maps 0 to 0 and 1 to 1", () => {
        for (const f of [linear, ease, easeIn, easeOut, easeInOut]) {
            assert.equal(f(0), 0);
            assert.equal(f(1), 1);
        }
    });
    test("ease-in is below linear at the start, ease-out above", () => {
        assert.ok(easeIn(0.25) < 0.25);
        assert.ok(easeOut(0.25) > 0.25);
    });
    test("steps: start jumps at once, end jumps at the end, middle halfway", () => {
        assert.equal(stepStart(0.1), 1);
        assert.equal(stepEnd(0.9), 0);
        assert.equal(stepMiddle(0.49), 0);
        assert.equal(stepMiddle(0.51), 1);
    });
    test("makeBezier(0,0,1,1) is linear within 1e-6; makeSteps(4) has four plateaus", () => {
        const b = makeBezier(0, 0, 1, 1);
        for (const t of [0.1, 0.5, 0.9]) {
            assert.ok(Math.abs(b(t) - t) < 1e-6);
        }
        const s = makeSteps(4, false);
        assert.deepEqual([s(0.1), s(0.3), s(0.6), s(0.9)], [0, 0.25, 0.5, 0.75]);
    });
    test('makeSteps takes a boolean: the string "end" is truthy and steps at the start', () => {
        // pins today's behaviour; see issue
        const s = makeSteps(4, /** @type {any} */ ("end"));
        assert.deepEqual([s(0.1), s(0.3), s(0.6), s(0.9)], [0.25, 0.5, 0.75, 1]);
    });
    test("reverse links: ease-in and ease-out reverse each other, steps likewise", () => {
        const reverse = f => /** @type {any} */ (f).reverse;
        assert.equal(reverse(easeIn), easeOut);
        assert.equal(reverse(easeOut), easeIn);
        assert.equal(reverse(stepStart), stepEnd);
        assert.equal(reverse(linear), linear);
    });
});
