import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {DisplayMirror, DisplayMirrorEvents} from "../../../src/js/presenter/DisplayMirror.js";
import {
    Roles,
    blankMessage,
    frameChangeMessage,
    helloMessage,
    nextMessage
} from "../../../src/js/protocol/messages.js";
import {TransportStatus} from "../../../src/js/protocol/LocalTransport.js";
import {STOPPED_TIMER, timerMessage} from "../../../src/js/protocol/timer.js";
import {ON_FRAME, cameraMessage} from "../../../src/js/protocol/camera.js";

const one = {index: 0, id: "f1", title: "One", notes: "<p>First</p>"};
const two = {index: 1, id: "f2", title: "Two", notes: ""};
const viewport = {width: 1200, height: 400, pixelRatio: 2};
const frames = [one, two];
const dock = {grid: {}, panels: {current: {id: "current"}}};
// Cast: the field's own literal types are lost on a constant.
const layouts = /** @type {any} */ ({
    phone: {match: "phone", layout: {version: 1, dock, rail: []}}
});
const state = {
    deckId: "basic",
    version: "v1",
    frameCount: 2,
    viewport,
    frame: one,
    frames,
    blank: false,
    layouts,
    timer: STOPPED_TIMER
};
const running = {elapsedMs: 1000, running: true, targetMs: null};
const panned = {offFrame: true, zoom: 1, x: -0.1, y: 0};

/** A mirror on a clock the test moves.
 *
 * @returns {{mirror: DisplayMirror, clock: {time: number}}} - Both.
 */
function clockedMirror() {
    const clock = {time: 500};
    return {mirror: new DisplayMirror(() => clock.time), clock};
}

/** A mirror and the changes it has emitted.
 *
 * @returns {{mirror: DisplayMirror, changes: object[]}} - Both.
 */
function watchedMirror() {
    const mirror = new DisplayMirror();
    const changes = [];
    mirror.on(DisplayMirrorEvents.change, part => changes.push(part));
    return {mirror, changes};
}

describe("DisplayMirror", () => {
    test("starts with nothing reported and the transport connected", () => {
        const mirror = new DisplayMirror();
        assert.equal(mirror.frameCount, 0);
        assert.equal(mirror.index, 0);
        assert.equal(mirror.frame, null);
        assert.equal(mirror.blank, false);
        assert.equal(mirror.viewport, null);
        assert.equal(mirror.status, TransportStatus.connected);
    });

    test("a display's hello sets everything it carries", () => {
        const {mirror, changes} = watchedMirror();
        mirror.apply(helloMessage(Roles.display, state));
        assert.equal(mirror.frameCount, 2);
        assert.equal(mirror.index, 0);
        assert.deepEqual(mirror.frame, one);
        assert.equal(mirror.blank, false);
        assert.deepEqual(mirror.viewport, viewport);
        assert.deepEqual(mirror.frames, frames);
        assert.deepEqual(mirror.layouts, layouts);
        assert.equal(mirror.deckId, "basic");
        assert.equal(mirror.version, "v1");
        assert.deepEqual(changes, [
            {
                frameCount: 2,
                blank: false,
                viewport,
                frame: one,
                frames,
                index: 0,
                layouts,
                deckId: "basic",
                version: "v1",
                timer: STOPPED_TIMER,
                camera: ON_FRAME
            }
        ]);
    });

    test("holds a camera on its frame until the display reports one", () => {
        assert.deepEqual(new DisplayMirror().camera, ON_FRAME);
    });

    test("a hello carries the camera, and a camera message replaces it, and only that", () => {
        const {mirror, changes} = watchedMirror();
        mirror.apply(helloMessage(Roles.display, {...state, camera: panned}));
        assert.deepEqual(mirror.camera, panned);
        changes.length = 0;
        mirror.apply(cameraMessage(ON_FRAME));
        assert.deepEqual(mirror.camera, ON_FRAME);
        assert.deepEqual(changes, [{camera: ON_FRAME}]);
    });

    test("holds a stopped timer until the display reports one", () => {
        const {mirror} = clockedMirror();
        assert.deepEqual(mirror.timer, STOPPED_TIMER);
        assert.equal(mirror.elapsedAt(), 0);
    });

    test("a hello carries the timer, counted from when it arrived", () => {
        const {mirror, clock} = clockedMirror();
        mirror.apply(helloMessage(Roles.display, {...state, timer: running}));
        assert.deepEqual(mirror.timer, running);
        assert.equal(mirror.elapsedAt(), 1000);
        clock.time += 250;
        assert.equal(mirror.elapsedAt(), 1250);
    });

    test("a timer message replaces the timer, and only that", () => {
        const {mirror, clock} = clockedMirror();
        const changes = [];
        mirror.on(DisplayMirrorEvents.change, part => changes.push(part));
        clock.time = 2000;
        mirror.apply(timerMessage(running));
        assert.deepEqual(changes, [{timer: running}]);
        clock.time = 3000;
        assert.equal(mirror.elapsedAt(), 2000);
    });

    test("a stopped timer does not count", () => {
        const {mirror, clock} = clockedMirror();
        mirror.apply(timerMessage({...running, running: false}));
        clock.time += 5000;
        assert.equal(mirror.elapsedAt(), 1000);
    });

    test("elapsedAt reads the timer at a given time", () => {
        const {mirror} = clockedMirror();
        mirror.apply(timerMessage(running));
        assert.equal(mirror.elapsedAt(600), 1100);
    });

    test("stops counting while the status is not connected, and takes up again", () => {
        const {mirror, clock} = clockedMirror();
        mirror.apply(timerMessage(running));
        clock.time += 1000;
        mirror.setStatus(TransportStatus.closed);
        clock.time += 5000;
        assert.equal(mirror.elapsedAt(), 2000);
        mirror.setStatus("stale");
        clock.time += 5000;
        assert.equal(mirror.elapsedAt(), 2000);
        mirror.setStatus(TransportStatus.connected);
        assert.equal(mirror.elapsedAt(), 12000);
    });

    test("a timer that arrives while the link is down never reads below what it says", () => {
        const {mirror, clock} = clockedMirror();
        mirror.setStatus(TransportStatus.closed);
        clock.time += 1000;
        mirror.apply(timerMessage(running));
        clock.time += 1000;
        assert.equal(mirror.elapsedAt(), 1000);
    });

    test("has no frames until the display says hello, and a frame change keeps them", () => {
        const {mirror} = watchedMirror();
        assert.deepEqual(mirror.frames, []);
        mirror.apply(helloMessage(Roles.display, state));
        mirror.apply(frameChangeMessage(two));
        assert.deepEqual(mirror.frames, frames);
    });

    test("has no layout presets until the display says hello", () => {
        assert.deepEqual(new DisplayMirror().layouts, {});
    });

    test("a hello without a viewport keeps the last one", () => {
        const {mirror, changes} = watchedMirror();
        mirror.apply(helloMessage(Roles.display, state));
        mirror.apply(helloMessage(Roles.display, {...state, viewport: null}));
        assert.deepEqual(mirror.viewport, viewport);
        assert.equal(Object.hasOwn(changes[1], "viewport"), false);
    });

    test("a frame change moves the index and the frame", () => {
        const {mirror, changes} = watchedMirror();
        mirror.apply(frameChangeMessage(two));
        assert.equal(mirror.index, 1);
        assert.deepEqual(mirror.frame, two);
        assert.deepEqual(changes, [{frame: two, index: 1}]);
    });

    test("a viewport message changes the viewport only", () => {
        const {mirror, changes} = watchedMirror();
        mirror.apply({name: "viewport", ...viewport});
        assert.deepEqual(mirror.viewport, viewport);
        assert.deepEqual(changes, [{viewport}]);
    });

    test("a blank message changes the blank screen only", () => {
        const {mirror, changes} = watchedMirror();
        mirror.apply(blankMessage(true));
        assert.equal(mirror.blank, true);
        assert.deepEqual(changes, [{blank: true}]);
    });

    test("messages a display does not send change nothing", () => {
        const {mirror, changes} = watchedMirror();
        mirror.apply(helloMessage(Roles.surface));
        mirror.apply(nextMessage());
        assert.deepEqual(changes, []);
        assert.equal(mirror.frame, null);
    });

    test("the transport's status is mirrored too", () => {
        const {mirror, changes} = watchedMirror();
        mirror.setStatus(TransportStatus.closed);
        assert.equal(mirror.status, TransportStatus.closed);
        assert.deepEqual(changes, [{status: TransportStatus.closed}]);
    });

    test("dispose removes every listener", () => {
        const {mirror, changes} = watchedMirror();
        mirror.dispose();
        mirror.apply(blankMessage(true));
        assert.deepEqual(changes, []);
        assert.equal(mirror.listenerCount(DisplayMirrorEvents.change), 0);
    });
});
