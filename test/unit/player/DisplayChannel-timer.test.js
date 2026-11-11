// The talk timer's side of DisplayChannel: frame changes start it, surfaces drive it, and its
// state is reported and carried in the hello. The rest of the channel is in
// DisplayChannel.test.js.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {fakeTransport} from "./fakeDeck.js";
import {displayHello, startedDisplay} from "./displayWorld.js";
import {TalkTimerEvents} from "../../../src/js/player/TalkTimer.js";
import {
    Roles,
    helloMessage,
    frameChangeMessage,
    previewMessage
} from "../../../src/js/protocol/messages.js";
import {
    TimerActions,
    timerActionMessage,
    timerMessage,
    timerTargetMessage
} from "../../../src/js/protocol/timer.js";

describe("DisplayChannel and the talk timer", () => {
    test("the first frame change starts the timer and is reported, after the frame", () => {
        const {player, timer, transport} = startedDisplay();
        player.showFrame(1);
        assert.equal(timer.state.running, true);
        assert.deepEqual(transport.sent, [
            frameChangeMessage({index: 1, id: "f2", title: "Two", notes: "second"}),
            timerMessage({elapsedMs: 0, running: true, targetMs: null})
        ]);
    });

    test("a surface's timer actions reach the timer, and each change is reported", () => {
        const {timer, clock, transport} = startedDisplay();
        transport.deliver(timerActionMessage(TimerActions.start));
        clock.time = 1000;
        transport.deliver(timerActionMessage(TimerActions.pause));
        assert.deepEqual(timer.state, {elapsedMs: 1000, running: false, targetMs: null});
        transport.deliver(timerActionMessage(TimerActions.reset));
        assert.deepEqual(timer.state, {elapsedMs: 0, running: false, targetMs: null});
        assert.deepEqual(transport.sent, [
            timerMessage({elapsedMs: 0, running: true, targetMs: null}),
            timerMessage({elapsedMs: 1000, running: false, targetMs: null}),
            timerMessage({elapsedMs: 0, running: false, targetMs: null})
        ]);
    });

    test("a surface's target reaches the timer, and is reported", () => {
        const {timer, transport} = startedDisplay();
        transport.deliver(timerTargetMessage(60000));
        assert.equal(timer.state.targetMs, 60000);
        transport.deliver(timerTargetMessage(null));
        assert.equal(timer.state.targetMs, null);
        assert.deepEqual(transport.sent, [
            timerMessage({elapsedMs: 0, running: false, targetMs: 60000}),
            timerMessage({elapsedMs: 0, running: false, targetMs: null})
        ]);
    });

    test("a change of the timer goes out on every link", () => {
        const {channel, timer, transport} = startedDisplay();
        const other = fakeTransport();
        channel.addTransport(other);
        other.sent.length = 0;
        timer.start();
        assert.deepEqual(transport.sent, other.sent);
        assert.equal(other.sent.length, 1);
    });

    test("a hello while the timer runs carries the time counted so far", () => {
        const {timer, clock, transport} = startedDisplay();
        timer.start();
        clock.time = 3000;
        transport.sent.length = 0;
        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(
            transport.sent[0],
            displayHello({timer: {elapsedMs: 3000, running: true, targetMs: null}})
        );
    });

    test("a preview reports nothing about its timer", () => {
        const {player, timer, transport} = startedDisplay();
        transport.deliver(previewMessage(true));
        player.showFrame(1);
        timer.reset();
        assert.deepEqual(transport.sent, []);
    });

    test("dispose stops listening to the timer", () => {
        const {channel, timer} = startedDisplay();
        channel.dispose();
        assert.equal(timer.listenerCount(TalkTimerEvents.change), 0);
    });
});
