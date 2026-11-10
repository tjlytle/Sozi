import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {TalkTimer, TalkTimerEvents} from "../../../src/js/player/TalkTimer.js";

/** A timer on a clock the test moves, and the changes it has told.
 *
 * @returns {any} - The timer, how many changes, and the function that moves the clock.
 */
function watchedTimer() {
    let time = 1000;
    const timer = new TalkTimer(() => time);
    const seen = {changes: 0};
    timer.on(TalkTimerEvents.change, () => seen.changes++);
    return {
        timer,
        seen,
        moveOn(ms) {
            time += ms;
        }
    };
}

describe("TalkTimer", () => {
    test("starts stopped at zero, with no target, however long it waits", () => {
        const {timer, moveOn} = watchedTimer();
        moveOn(5000);
        assert.deepEqual(timer.state, {elapsedMs: 0, running: false, targetMs: null});
    });

    test("the first frame change starts it, and only the first", () => {
        const {timer, seen, moveOn} = watchedTimer();
        timer.frameChanged();
        assert.equal(timer.state.running, true);
        moveOn(2000);
        timer.frameChanged();
        moveOn(1000);
        assert.equal(timer.state.elapsedMs, 3000);
        assert.equal(seen.changes, 1);
    });

    test("Start gets in before the first frame change, which then changes nothing", () => {
        const {timer, seen, moveOn} = watchedTimer();
        timer.start();
        moveOn(1000);
        timer.frameChanged();
        assert.equal(timer.state.elapsedMs, 1000);
        assert.equal(seen.changes, 1);
    });

    test("pause holds it, and start resumes it from there", () => {
        const {timer, moveOn} = watchedTimer();
        timer.start();
        moveOn(1000);
        timer.pause();
        moveOn(5000);
        assert.deepEqual(timer.state, {elapsedMs: 1000, running: false, targetMs: null});
        timer.start();
        moveOn(500);
        assert.equal(timer.state.elapsedMs, 1500);
    });

    test("a frame change does not restart a paused timer", () => {
        const {timer, moveOn} = watchedTimer();
        timer.frameChanged();
        moveOn(1000);
        timer.pause();
        timer.frameChanged();
        moveOn(5000);
        assert.deepEqual(timer.state, {elapsedMs: 1000, running: false, targetMs: null});
    });

    test("reset returns it to zero, stopped, and the next frame change starts it", () => {
        const {timer, moveOn} = watchedTimer();
        timer.start();
        moveOn(1000);
        timer.reset();
        assert.deepEqual(timer.state, {elapsedMs: 0, running: false, targetMs: null});
        moveOn(1000);
        assert.equal(timer.state.elapsedMs, 0);
        timer.frameChanged();
        moveOn(500);
        assert.deepEqual(timer.state, {elapsedMs: 500, running: true, targetMs: null});
    });

    test("reset keeps the target", () => {
        const {timer} = watchedTimer();
        timer.setTarget(60000);
        timer.reset();
        assert.equal(timer.state.targetMs, 60000);
    });

    test("a target is set and cleared, and changes no time", () => {
        const {timer, seen, moveOn} = watchedTimer();
        timer.start();
        moveOn(1000);
        seen.changes = 0;
        timer.setTarget(60000);
        assert.deepEqual(timer.state, {elapsedMs: 1000, running: true, targetMs: 60000});
        timer.setTarget(null);
        assert.equal(timer.state.targetMs, null);
        assert.equal(seen.changes, 2);
    });

    test("each change is told once; what changes nothing is not told", () => {
        const {timer, seen} = watchedTimer();
        timer.pause();
        assert.equal(seen.changes, 0);
        timer.start();
        timer.start();
        assert.equal(seen.changes, 1);
        timer.pause();
        timer.pause();
        assert.equal(seen.changes, 2);
        timer.reset();
        assert.equal(seen.changes, 3);
    });

    test("pausing a timer that never ran leaves the first frame change to start it", () => {
        const {timer} = watchedTimer();
        timer.pause();
        timer.frameChanged();
        assert.equal(timer.state.running, true);
    });

    test("dispose removes every listener", () => {
        const {timer, seen} = watchedTimer();
        timer.dispose();
        timer.start();
        assert.equal(seen.changes, 0);
        assert.equal(timer.listenerCount(TalkTimerEvents.change), 0);
    });
});
