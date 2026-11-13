import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    Roles,
    deckIdOf,
    helloMessage,
    readFrame,
    readHello
} from "../../../src/js/protocol/hello.js";
import {MessageNames, readMessage} from "../../../src/js/protocol/messages.js";
import {STOPPED_TIMER} from "../../../src/js/protocol/timer.js";
import {ON_FRAME} from "../../../src/js/protocol/camera.js";
import {EMPTY_DRAWINGS} from "../../../src/js/protocol/drawings.js";

const timer = {elapsedMs: 1500, running: true, targetMs: 60000};
const camera = {offFrame: true, zoom: 2, x: -0.5, y: 0.25};
const stroke = {id: "s1", tool: "pen", color: "#ff0000", width: 6, points: [[1, 2, 0.5]]};
const drawings = {visible: false, strokes: [{...stroke, done: true}]};
const frame = {index: 1, id: "frame2", title: "Two", notes: "<p>Second</p>"};
const viewport = {width: 1200, height: 400, pixelRatio: 2};
const frames = [{index: 0, id: "frame1", title: "One", notes: ""}, frame];
const dock = {grid: {}, panels: {current: {id: "current"}}};
// Cast: the field's own literal types are lost on a constant.
const layouts = /** @type {any} */ ({
    phone: {match: "phone", layout: {version: 1, dock, rail: []}}
});
const displayState = {
    deckId: "basic",
    version: "11/06/2026 18:26:48",
    frameCount: 2,
    viewport,
    frame,
    frames,
    blank: false,
    layouts,
    timer,
    camera,
    drawings
};
const hello = helloMessage(Roles.display, displayState);

describe("protocol hello", () => {
    test("the builder names its message", () => {
        assert.deepEqual(helloMessage(Roles.surface), {name: "hello", role: "surface"});
        assert.deepEqual(hello, {name: MessageNames.hello, role: "display", ...displayState});
    });

    test("every built hello reads back unchanged", () => {
        for (const message of [
            helloMessage(Roles.surface),
            hello,
            helloMessage(Roles.display, {...displayState, viewport: null})
        ]) {
            assert.deepEqual(readMessage(message), message, message.role);
        }
    });

    test("readHello reads a hello on its own", () => {
        assert.deepEqual(readHello(hello), hello);
        assert.equal(readHello({name: "hello", role: "audience"}), null);
    });

    test("readFrame keeps a frame's fields and refuses a malformed one", () => {
        assert.deepEqual(readFrame({...frame, extra: 1}), frame);
        for (const bad of [null, "frame", {...frame, index: -1}, {...frame, notes: null}]) {
            assert.equal(readFrame(bad), null, JSON.stringify(bad));
        }
    });

    test("a display's hello keeps its frames and drops their other fields", () => {
        const read = readMessage({...hello, frames: [{...frames[0], extra: 1}, frame]});
        assert.deepEqual(/** @type {any} */ (read).frames, frames);
    });

    test("a display's hello from before the frames list reads as an empty list", () => {
        const older = {...hello, frames: undefined};
        assert.deepEqual(/** @type {any} */ (readMessage(older)).frames, []);
    });

    test("a display's hello from before the version field reads as an empty version", () => {
        const older = {...hello, version: undefined};
        assert.equal(/** @type {any} */ (readMessage(older)).version, "");
    });

    test("a display's hello with a version that is not a string is refused", () => {
        assert.equal(readMessage({...hello, version: 3}), null);
    });

    test("a display's hello keeps the deck's layout presets", () => {
        assert.deepEqual(/** @type {any} */ (readMessage(hello)).layouts, layouts);
    });

    test("a hello from a deck that has no presets field reads as none", () => {
        const older = {...hello, layouts: undefined};
        assert.deepEqual(/** @type {any} */ (readMessage(older)).layouts, {});
        const state = {...displayState, layouts: undefined};
        assert.deepEqual(/** @type {any} */ (helloMessage(Roles.display, state)).layouts, {});
    });

    test("a bad preset is dropped, never the whole hello", () => {
        const withBad = {
            ...hello,
            layouts: {...layouts, bad: {match: "tablet"}, "a.b": layouts.phone}
        };
        const read = /** @type {any} */ (readMessage(withBad));
        assert.equal(read.deckId, "basic");
        assert.deepEqual(read.layouts, layouts);
        const worse = {...withBad, layouts: "none"};
        assert.deepEqual(/** @type {any} */ (readMessage(worse)).layouts, {});
    });

    test("a display's hello keeps the timer and drops its other fields", () => {
        const read = readMessage({...hello, timer: {...timer, extra: 1}});
        assert.deepEqual(/** @type {any} */ (read).timer, timer);
    });

    test("a hello from a deck from before the timer reads as a stopped timer", () => {
        const older = {...hello, timer: undefined};
        assert.deepEqual(/** @type {any} */ (readMessage(older)).timer, STOPPED_TIMER);
    });

    test("a hello with a malformed timer is refused", () => {
        for (const bad of [null, "running", {...timer, elapsedMs: -1}, {...timer, targetMs: 0}]) {
            assert.equal(readMessage({...hello, timer: bad}), null, JSON.stringify(bad));
        }
    });

    test("a display's hello keeps the camera and drops its other fields", () => {
        const read = readMessage({...hello, camera: {...camera, extra: 1}});
        assert.deepEqual(/** @type {any} */ (read).camera, camera);
    });

    test("a hello from a deck from before the camera reads as a camera on its frame", () => {
        const older = {...hello, camera: undefined};
        assert.deepEqual(/** @type {any} */ (readMessage(older)).camera, ON_FRAME);
    });

    test("a hello with a malformed camera is refused", () => {
        for (const bad of [null, {...camera, zoom: 0}, {...camera, offFrame: "yes"}]) {
            assert.equal(readMessage({...hello, camera: bad}), null, JSON.stringify(bad));
        }
    });

    test("a display's hello carries the drawings", () => {
        const read = /** @type {any} */ (
            readMessage({...hello, drawings: {...drawings, extra: 1}})
        );
        assert.deepEqual(read.drawings, drawings);
    });

    test("a hello from a deck from before the drawings reads as empty drawings", () => {
        const older = {...hello, drawings: undefined};
        assert.deepEqual(/** @type {any} */ (readMessage(older)).drawings, EMPTY_DRAWINGS);
    });

    test("a hello with malformed drawings is refused", () => {
        for (const bad of [null, {visible: true}, {...drawings, visible: "yes"}]) {
            assert.equal(readMessage({...hello, drawings: bad}), null, JSON.stringify(bad));
        }
    });

    test("a surface's hello carries no presets", () => {
        assert.deepEqual(readMessage(helloMessage(Roles.surface)), {
            name: "hello",
            role: "surface"
        });
    });

    test("is refused with a malformed field", () => {
        const bad = [
            {name: "hello"},
            {name: "hello", role: "audience"},
            {...hello, deckId: 3},
            {...hello, frameCount: -1},
            {...hello, frameCount: 1.5},
            {...hello, viewport: {width: 0}},
            {...hello, frame: null},
            {...hello, blank: "no"},
            {...hello, frames: "all"},
            {...hello, frames: null},
            {...hello, frames: [frame, {index: 2}]},
            {...hello, frames: [frame, null]}
        ];
        for (const data of bad) {
            assert.equal(readMessage(data), null, JSON.stringify(data));
        }
    });

    test("a deck id is the page's file name without .sozi.html", () => {
        assert.equal(deckIdOf("/home/tim/talks/basic.sozi.html"), "basic");
        assert.equal(deckIdOf("/talks/my%20talk.sozi.html"), "my talk");
        assert.equal(deckIdOf("/talks/index.html"), "index.html");
        assert.equal(deckIdOf(""), "");
    });
});
