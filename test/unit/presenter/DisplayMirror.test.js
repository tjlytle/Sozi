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
    layouts
};

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
                version: "v1"
            }
        ]);
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
