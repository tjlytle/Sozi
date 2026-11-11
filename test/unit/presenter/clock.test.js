import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    MINUTE_MS,
    TimerPhases,
    formatDuration,
    readTargetMinutes,
    remainingText,
    targetFieldText,
    timerPhase
} from "../../../src/js/presenter/clock.js";

const SECOND = 1000;
const HOUR = 60 * MINUTE_MS;

describe("clock", () => {
    test("a duration reads MM:SS, then H:MM:SS from one hour", () => {
        assert.equal(formatDuration(0), "00:00");
        assert.equal(formatDuration(999), "00:00");
        assert.equal(formatDuration(65 * SECOND), "01:05");
        assert.equal(formatDuration(HOUR - SECOND), "59:59");
        assert.equal(formatDuration(HOUR), "1:00:00");
        assert.equal(formatDuration(11 * HOUR + 2 * MINUTE_MS + 3 * SECOND), "11:02:03");
    });

    test("the phase turns near at 80% of the target and over at the target", () => {
        const target = 1000 * SECOND;
        assert.equal(timerPhase(799 * SECOND, target), TimerPhases.normal);
        assert.equal(timerPhase(800 * SECOND, target), TimerPhases.near);
        assert.equal(timerPhase(target - 1, target), TimerPhases.near);
        assert.equal(timerPhase(target, target), TimerPhases.over);
        assert.equal(timerPhase(2 * target, target), TimerPhases.over);
    });

    test("with no target the phase stays normal", () => {
        assert.equal(timerPhase(10 * HOUR, null), TimerPhases.normal);
    });

    test("the remaining time reads left, then over", () => {
        assert.equal(remainingText(16 * MINUTE_MS, 20 * MINUTE_MS), "04:00 left");
        assert.equal(remainingText(21 * MINUTE_MS, 20 * MINUTE_MS), "01:00 over");
        assert.equal(remainingText(20 * MINUTE_MS, 20 * MINUTE_MS), "00:00 over");
    });

    test("elapsed and left add up to the target, whichever way the second falls", () => {
        // 15:59 shown as elapsed, half a second into the next second.
        assert.equal(remainingText(16 * MINUTE_MS - 500, 20 * MINUTE_MS), "04:01 left");
    });

    test("with no target there is no remaining time", () => {
        assert.equal(remainingText(5 * MINUTE_MS, null), "");
    });

    test("the target field reads as minutes, empty as none, anything else as no target", () => {
        assert.equal(readTargetMinutes("5"), 5);
        assert.equal(readTargetMinutes(" 20 "), 20);
        assert.equal(readTargetMinutes("1.5"), 1.5);
        assert.equal(readTargetMinutes(""), null);
        assert.equal(readTargetMinutes("  "), null);
        for (const text of ["0", "0.0", "abc", "-5", "5m", "1e3", "9".repeat(400)]) {
            assert.equal(readTargetMinutes(text), undefined, text);
        }
    });

    test("a target too long to time in milliseconds is no target", () => {
        assert.equal(readTargetMinutes("9".repeat(305)), undefined);
        assert.equal(typeof readTargetMinutes("9".repeat(300)), "number");
    });

    test("a target is shown in the field as minutes, no target as nothing", () => {
        assert.equal(targetFieldText(20 * MINUTE_MS), "20");
        assert.equal(targetFieldText(1.5 * MINUTE_MS), "1.5");
        assert.equal(targetFieldText(null), "");
    });
});
