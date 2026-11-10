import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    STOPPED_TIMER,
    TimerActions,
    elapsedAfter,
    readTimer,
    readTimerAction,
    readTimerState,
    readTimerTarget,
    timerActionMessage,
    timerMessage,
    timerTargetMessage
} from "../../../src/js/protocol/timer.js";

const running = {elapsedMs: 1500, running: true, targetMs: 60000};

describe("protocol timer", () => {
    test("each builder names its message", () => {
        assert.deepEqual(timerMessage(running), {name: "timer", ...running});
        assert.deepEqual(timerActionMessage(TimerActions.pause), {
            name: "timerAction",
            action: "pause"
        });
        assert.deepEqual(timerTargetMessage(60000), {name: "timerTarget", targetMs: 60000});
        assert.deepEqual(timerTargetMessage(null), {name: "timerTarget", targetMs: null});
    });

    test("every built message reads back unchanged", () => {
        assert.deepEqual(readTimer(timerMessage(running)), timerMessage(running));
        assert.deepEqual(readTimer(timerMessage(STOPPED_TIMER)), timerMessage(STOPPED_TIMER));
        for (const action of Object.values(TimerActions)) {
            assert.deepEqual(readTimerAction(timerActionMessage(action)), {
                name: "timerAction",
                action
            });
        }
        assert.deepEqual(readTimerTarget(timerTargetMessage(5)), timerTargetMessage(5));
        assert.deepEqual(readTimerTarget(timerTargetMessage(null)), timerTargetMessage(null));
    });

    test("fields that are not part of the message are dropped", () => {
        assert.deepEqual(readTimer({...timerMessage(running), extra: 1}), timerMessage(running));
    });

    test("a stopped timer has counted nothing and has no target", () => {
        assert.deepEqual(STOPPED_TIMER, {elapsedMs: 0, running: false, targetMs: null});
    });

    test("a malformed state is refused", () => {
        for (const state of [
            null,
            "running",
            {...running, elapsedMs: -1},
            {...running, elapsedMs: NaN},
            {...running, elapsedMs: Infinity},
            {...running, elapsedMs: "5"},
            {...running, elapsedMs: undefined},
            {...running, running: 1},
            {...running, targetMs: 0},
            {...running, targetMs: -5},
            {...running, targetMs: NaN},
            {...running, targetMs: undefined}
        ]) {
            assert.equal(readTimerState(state), null, JSON.stringify(state));
        }
    });

    test("an unknown action is refused", () => {
        for (const action of ["stop", "", undefined, 1, "constructor"]) {
            assert.equal(readTimerAction({name: "timerAction", action}), null, String(action));
        }
    });

    test("a target that is not positive, finite or null is refused", () => {
        for (const targetMs of [0, -1, NaN, Infinity, "5", undefined]) {
            assert.equal(readTimerTarget({name: "timerTarget", targetMs}), null, String(targetMs));
        }
    });

    test("elapsedAfter adds the time since the state was read, while it runs", () => {
        assert.equal(elapsedAfter(running, 500), 2000);
        assert.equal(elapsedAfter({...running, running: false}, 500), 1500);
    });
});
