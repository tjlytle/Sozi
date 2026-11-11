import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {DisplayChannel, DisplayChannelEvents} from "../../../src/js/player/DisplayChannel.js";
import {PlayerEvents} from "../../../src/js/player/playerEvents.js";
import {PlayerControllerEvents} from "../../../src/js/player/PlayerController.js";
import {
    ON_FRAME,
    cameraMessage,
    cameraMoveMessage,
    cameraResetMessage,
    composeView
} from "../../../src/js/protocol/camera.js";
import {Roles, helloMessage} from "../../../src/js/protocol/hello.js";
import {
    frameChangeMessage,
    blankMessage,
    jumpToFrameMessage,
    nextMessage,
    previousMessage,
    customMessage,
    previewMessage,
    followLinkMessage,
    keyMessage
} from "../../../src/js/protocol/messages.js";
import {thumbnailMessage, thumbnailRequestMessage} from "../../../src/js/protocol/thumbnails.js";
import {viewportMessage} from "../../../src/js/protocol/viewport.js";
import {
    TimerActions,
    timerActionMessage,
    timerMessage,
    timerTargetMessage
} from "../../../src/js/protocol/timer.js";
import {TalkTimer, TalkTimerEvents} from "../../../src/js/player/TalkTimer.js";

const frames = [
    {index: 0, frameId: "f1", title: "One", notes: "first"},
    {index: 1, frameId: "f2", title: "Two", notes: "second"}
];

/** Stand-in for the player: the current frame, the blank screen and the moves it makes.
 *
 * @returns {any} - The fake player; `calls` lists each move.
 */
function fakePlayer() {
    const player = /** @type {any} */ (new EventEmitter());
    Object.assign(player, {
        calls: [],
        currentFrame: frames[0],
        nextFrame: frames[1],
        previousFrame: frames[1],
        blankScreenIsVisible: false,
        enableBlankScreen() {
            player.calls.push(["enableBlankScreen"]);
            player.setBlank(true);
        },
        disableBlankScreen() {
            player.calls.push(["disableBlankScreen"]);
            player.setBlank(false);
        },
        setBlank(on) {
            if (on !== player.blankScreenIsVisible) {
                player.blankScreenIsVisible = on;
                player.emit(PlayerEvents.blankScreenChange);
            }
        },
        jumpToFrame(f) {
            player.calls.push(["jumpToFrame", f]);
        },
        moveToFrame(f) {
            player.calls.push(["moveToFrame", f]);
        },
        showFrame(index) {
            player.currentFrame = frames[index];
            player.emit(PlayerEvents.frameChange);
        }
    });
    return player;
}

/** Stand-in for the deck's viewport: its size, and the zooms and pans applied to it.
 *
 * @returns {any} - The fake viewport; `calls` lists each one.
 */
function fakeViewport() {
    const calls = [];
    return {
        calls,
        width: 1200,
        height: 400,
        zoom: (factor, x, y) => calls.push(["zoom", factor, x, y]),
        translate: (deltaX, deltaY) => calls.push(["translate", deltaX, deltaY])
    };
}

/** Stand-in for the player controller: it records each method called on it, and emits the
 * events of a zoom and a pan as the real one does.
 *
 * @param {any} player - The fake player, for the blank screen toggle.
 * @returns {any} - The fake controller.
 */
function fakeController(player) {
    const calls = [];
    const record =
        name =>
        (...args) =>
            calls.push([name, ...args]);
    const controller = /** @type {any} */ (new EventEmitter());
    return Object.assign(controller, {
        calls,
        viewport: fakeViewport(),
        moveToNext: record("moveToNext"),
        jumpToNext: record("jumpToNext"),
        moveToPrevious: record("moveToPrevious"),
        jumpToPrevious: record("jumpToPrevious"),
        moveToFrame: record("moveToFrame"),
        jumpToFrame: record("jumpToFrame"),
        toggleBlankScreen() {
            calls.push(["toggleBlankScreen"]);
            player.setBlank(!player.blankScreenIsVisible);
        },
        zoom(factor, x, y) {
            calls.push(["zoom", factor, x, y]);
            controller.emit(PlayerControllerEvents.zoom, {factor, x, y});
        },
        translate(deltaX, deltaY) {
            calls.push(["translate", deltaX, deltaY]);
            controller.emit(PlayerControllerEvents.translate, {deltaX, deltaY});
        }
    });
}

/** Stand-in for a transport: it records what is sent and delivers what a test posts.
 *
 * @returns {any} - The fake transport.
 */
function fakeTransport() {
    return {
        sent: [],
        handlers: new Set(),
        disposed: false,
        status: "connected",
        send(message) {
            this.sent.push(message);
            return true;
        },
        onMessage(handler) {
            this.handlers.add(handler);
            return () => this.handlers.delete(handler);
        },
        on() {},
        off() {},
        dispose() {
            this.disposed = true;
        },
        deliver(data) {
            for (const handler of this.handlers) {
                handler(data);
            }
        }
    };
}

/** Stand-in for the window the deck plays in.
 *
 * @returns {any} - The fake host window.
 */
function fakeHost() {
    const listeners = new Set();
    return {
        listeners,
        location: {pathname: "/talks/basic.sozi.html"},
        document: {lastModified: "11/06/2026 18:26:48"},
        innerWidth: 1200,
        innerHeight: 400,
        devicePixelRatio: 2,
        MouseEvent: class {
            constructor(type) {
                this.type = type;
            }
        },
        addEventListener(type, listener) {
            assert.equal(type, "resize");
            listeners.add(listener);
        },
        removeEventListener(type, listener) {
            listeners.delete(listener);
        },
        resize(width, height) {
            this.innerWidth = width;
            this.innerHeight = height;
            for (const listener of listeners) {
                listener();
            }
        }
    };
}

/** Build a display channel on fakes, started, with what it sent on start cleared.
 *
 * @param {(index: number) => Promise<string>} [renderResult] - What a thumbnail render gives.
 * @returns {any} - The channel and its fakes.
 */
function startedDisplay(renderResult = async () => JPEG) {
    const player = fakePlayer();
    const controller = fakeController(player);
    const transport = fakeTransport();
    const host = fakeHost();
    const links = new Map();
    const presentation = {
        frames,
        document: {root: {getElementById: id => links.get(id) ?? null}}
    };
    const previews = [];
    const renders = [];
    const clock = {time: 0};
    const timer = new TalkTimer(() => clock.time);
    const channel = new DisplayChannel({
        renderThumbnail: (index, width) => {
            renders.push([index, width]);
            return renderResult(index);
        },
        timer,
        player,
        controller,
        presentation,
        transport,
        host,
        enterPreviewMode: ({isCurrent, onFollowLink, onKey, onCamera}) =>
            previews.push({current: isCurrent, onFollowLink, onKey, onCamera})
    });
    channel.start();
    const startSent = transport.sent.splice(0);
    return {
        channel,
        player,
        controller,
        transport,
        host,
        links,
        previews,
        renders,
        startSent,
        timer,
        clock
    };
}

const JPEG = "data:image/jpeg;base64,AAAA";
const firstFrame = {index: 0, id: "f1", title: "One", notes: "first"};
const everyFrame = [firstFrame, {index: 1, id: "f2", title: "Two", notes: "second"}];
const viewport = {width: 1200, height: 400, pixelRatio: 2};

/** The hello a display sends in the given state.
 *
 * @param {object} changes - The fields that differ from the first frame, not blank.
 * @returns {object} - The message.
 */
function displayHello(changes = {}) {
    return helloMessage(Roles.display, {
        deckId: "basic",
        version: "11/06/2026 18:26:48",
        frameCount: 2,
        viewport,
        frame: firstFrame,
        frames: everyFrame,
        blank: false,
        camera: ON_FRAME,
        ...changes
    });
}

describe("DisplayChannel", () => {
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

    test("its hello names the deck page's date as its version", () => {
        const {transport} = startedDisplay();
        transport.deliver(helloMessage(Roles.surface));
        assert.equal(transport.sent.at(-1).version, "11/06/2026 18:26:48");
    });

    test("a thumbnail request outside preview mode is ignored", async () => {
        const {transport, renders} = startedDisplay();
        transport.deliver(thumbnailRequestMessage(1, 320));
        await new Promise(setImmediate);
        assert.deepEqual(renders, []);
        assert.deepEqual(transport.sent, []);
    });

    test("a thumbnail request in preview mode is rendered and answered", async () => {
        const {transport, renders} = startedDisplay();
        transport.deliver(previewMessage(false));
        transport.deliver(thumbnailRequestMessage(1, 320));
        await new Promise(setImmediate);
        assert.deepEqual(renders, [[1, 320]]);
        assert.deepEqual(transport.sent, [thumbnailMessage(1, JPEG)]);
    });

    test("a render that rejects is answered with an empty url", async () => {
        const {transport} = startedDisplay(async () => {
            throw new Error("tainted");
        });
        transport.deliver(previewMessage(false));
        transport.deliver(thumbnailRequestMessage(1, 320));
        await new Promise(setImmediate);
        assert.deepEqual(transport.sent, [thumbnailMessage(1, "")]);
    });

    test("its hello lists every frame in deck order, whichever is current", () => {
        const {player, transport} = startedDisplay();
        player.showFrame(1);
        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(transport.sent.at(-1).frames, everyFrame);
    });

    test("sends a display hello and the old loaded message on start", () => {
        const {startSent} = startedDisplay();
        assert.deepEqual(startSent, [displayHello(), {name: "loaded", length: 2}]);
    });

    test("a hello carries the deck's layout presets", () => {
        const {channel, transport} = startedDisplay();
        const dock = {grid: {}, panels: {current: {id: "current"}}};
        const presenterLayouts = {phone: {match: "phone", layout: {version: 1, dock, rail: []}}};
        channel.presentation.presenterLayouts = presenterLayouts;
        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(transport.sent, [displayHello({layouts: presenterLayouts})]);
    });

    test("answers a surface hello with its current frame and blank state", () => {
        const {transport, player} = startedDisplay();
        player.showFrame(1);
        player.setBlank(true);
        transport.sent.length = 0;
        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(transport.sent, [
            displayHello({
                frame: {index: 1, id: "f2", title: "Two", notes: "second"},
                blank: true,
                timer: {elapsedMs: 0, running: true, targetMs: null}
            })
        ]);
    });

    test("answers the old notifyOnFrameChange with a hello, the frame and the viewport", () => {
        const {transport} = startedDisplay();
        transport.deliver({name: "notifyOnFrameChange"});
        assert.deepEqual(transport.sent, [
            displayHello(),
            frameChangeMessage(firstFrame),
            viewportMessage({innerWidth: 1200, innerHeight: 400, devicePixelRatio: 2})
        ]);
    });

    test("ignores a hello from another display", () => {
        const {transport} = startedDisplay();
        transport.deliver(displayHello());
        assert.deepEqual(transport.sent, []);
    });

    test("a minimised window gives a hello with no viewport", () => {
        const {transport, host} = startedDisplay();
        host.innerWidth = 0;
        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(transport.sent, [displayHello({viewport: null})]);
    });

    test("sends frameChange, viewport and blank as they change", () => {
        const {transport, player, host} = startedDisplay();
        player.showFrame(1);
        host.resize(800, 600);
        player.setBlank(true);
        player.setBlank(false);
        assert.deepEqual(transport.sent, [
            frameChangeMessage({index: 1, id: "f2", title: "Two", notes: "second"}),
            timerMessage({elapsedMs: 0, running: true, targetMs: null}),
            viewportMessage({innerWidth: 800, innerHeight: 600, devicePixelRatio: 2}),
            blankMessage(true),
            blankMessage(false)
        ]);
    });

    test("sends each frame change once however many surfaces said hello", () => {
        const {transport, player, timer} = startedDisplay();
        // Started already, so that the frame change is all there is to send.
        timer.start();
        transport.deliver(helloMessage(Roles.surface));
        transport.deliver(helloMessage(Roles.surface));
        transport.sent.length = 0;
        player.showFrame(1);
        assert.equal(transport.sent.length, 1);
    });

    test("a surface that says hello again, by either name, adds no listener", () => {
        const {transport, player, host, timer} = startedDisplay();
        // Started already, so that no timer message comes between the two below.
        timer.start();
        transport.deliver(helloMessage(Roles.surface));
        transport.deliver(helloMessage(Roles.surface));
        transport.deliver({name: "notifyOnFrameChange"});
        transport.deliver({name: "notifyOnFrameChange"});
        transport.sent.length = 0;
        assert.equal(host.listeners.size, 1);
        assert.equal(player.listenerCount(PlayerEvents.frameChange), 1);
        player.showFrame(1);
        host.resize(800, 600);
        assert.deepEqual(transport.sent, [
            frameChangeMessage({index: 1, id: "f2", title: "Two", notes: "second"}),
            viewportMessage({innerWidth: 800, innerHeight: 600, devicePixelRatio: 2})
        ]);
    });

    test("hands each command to the controller", () => {
        const {transport, controller} = startedDisplay();
        transport.deliver(nextMessage(true));
        transport.deliver(nextMessage(false));
        transport.deliver(previousMessage(true));
        transport.deliver(previousMessage(false));
        transport.deliver(jumpToFrameMessage(1, true));
        transport.deliver(jumpToFrameMessage(0, false));
        assert.deepEqual(controller.calls, [
            ["moveToNext"],
            ["jumpToNext"],
            ["moveToPrevious"],
            ["jumpToPrevious"],
            ["moveToFrame", 1],
            ["jumpToFrame", 0]
        ]);
    });

    test("blank toggles the screen only when it changes it", () => {
        const {transport, controller, player} = startedDisplay();
        transport.deliver(blankMessage(false));
        transport.deliver(blankMessage(true));
        transport.deliver(blankMessage(true));
        assert.deepEqual(controller.calls, [["toggleBlankScreen"]]);
        assert.equal(player.blankScreenIsVisible, true);
    });

    test("old message names reach the controller through the legacy table", () => {
        const {transport, controller} = startedDisplay();
        transport.deliver({name: "moveToNext"});
        transport.deliver({name: "jumpToFrame", args: [1]});
        transport.deliver({name: "jumpToLast"});
        transport.deliver({name: "toggleBlankScreen"});
        transport.deliver({name: "moveToFrame", args: ["f2"]});
        assert.deepEqual(controller.calls, [
            ["moveToNext"],
            ["jumpToFrame", 1],
            ["jumpToFrame", 1],
            ["toggleBlankScreen"],
            ["moveToFrame", 1]
        ]);
    });

    test("an unknown name is logged and changes nothing", t => {
        const log = t.mock.method(console, "log", () => {});
        const {transport, controller} = startedDisplay();
        transport.deliver({name: "noSuchMethod"});
        transport.deliver({name: "next", transition: "maybe"});
        assert.deepEqual(controller.calls, []);
        assert.deepEqual(transport.sent, []);
        assert.deepEqual(
            log.mock.calls.map(c => c.arguments[0]),
            ["Unsupported message: noSuchMethod", "Unsupported message: next"]
        );
    });

    test("custom messages arrive as an event and are sent with sendCustom", () => {
        const {channel, transport} = startedDisplay();
        const received = [];
        channel.on(DisplayChannelEvents.custom, (type, data) => received.push([type, data]));
        transport.deliver(customMessage("poll", {q: 1}));
        channel.sendCustom("answer", [2]);
        assert.deepEqual(received, [["poll", {q: 1}]]);
        assert.deepEqual(transport.sent, [customMessage("answer", [2])]);
    });

    test("a followLink clicks the link with that id", () => {
        const {transport, links} = startedDisplay();
        const clicks = [];
        links.set("a1", {dispatchEvent: evt => clicks.push(evt.type)});
        transport.deliver(followLinkMessage("a1"));
        transport.deliver(followLinkMessage("missing"));
        assert.deepEqual(clicks, ["click"]);
    });

    test("preview mode drives the player and reports link clicks as followLink", () => {
        const {transport, player, controller, previews, host} = startedDisplay();
        transport.deliver(previewMessage(true));
        assert.equal(previews.length, 1);
        assert.equal(previews[0].current, true);

        transport.deliver(jumpToFrameMessage(1, false));
        transport.deliver(jumpToFrameMessage(0, true));
        transport.deliver(blankMessage(true));
        transport.deliver(blankMessage(false));
        transport.deliver(nextMessage(false));
        transport.deliver(previousMessage(true));
        assert.deepEqual(controller.calls, []);
        assert.deepEqual(player.calls, [
            ["jumpToFrame", 1],
            ["moveToFrame", 0],
            ["enableBlankScreen"],
            ["disableBlankScreen"],
            ["jumpToFrame", frames[1]],
            ["moveToFrame", frames[1]]
        ]);

        // A preview reports nothing about itself but its hello and its link clicks.
        transport.sent.length = 0;
        player.showFrame(1);
        host.resize(300, 200);
        previews[0].onFollowLink("a1");
        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(transport.sent.slice(0, 1), [followLinkMessage("a1")]);
        assert.equal(transport.sent.length, 2);
        assert.equal(transport.sent[1].name, "hello");
    });

    test("a preview reports the keys pressed in it as key", () => {
        const {transport, previews} = startedDisplay();
        transport.deliver(previewMessage(false));
        const modifiers = {shift: true, alt: false, ctrl: false, meta: false};
        previews[0].onKey("End", modifiers);
        assert.deepEqual(transport.sent, [keyMessage("End", modifiers)]);
    });

    test("enters preview mode once", () => {
        const {transport, previews} = startedDisplay();
        transport.deliver(previewMessage(false));
        transport.deliver(previewMessage(true));
        assert.equal(previews.length, 1);
    });

    test("a transport added says hello on its own, and each hello is answered on its own", () => {
        const {channel, transport} = startedDisplay();
        const added = fakeTransport();
        channel.addTransport(added);
        assert.deepEqual(added.sent, [channel.hello]);
        assert.deepEqual(transport.sent, []);
        added.sent.length = 0;

        added.deliver(helloMessage(Roles.surface));
        assert.deepEqual(added.sent, [channel.hello]);
        assert.deepEqual(transport.sent, []);
        added.sent.length = 0;

        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(transport.sent, [channel.hello]);
        assert.deepEqual(added.sent, []);
    });

    test("what the display reports reaches every transport", () => {
        const {channel, transport, player, timer} = startedDisplay();
        const added = fakeTransport();
        channel.addTransport(added);
        // Started already, so that the frame change is all there is to report.
        timer.start();
        added.sent.length = 0;
        transport.sent.length = 0;

        player.showFrame(1);
        channel.sendCustom("pong", 1);
        const expected = [frameChangeMessage(channel.frameInfo), customMessage("pong", 1)];
        assert.deepEqual(transport.sent, expected);
        assert.deepEqual(added.sent, expected);
    });

    test("a command from an added transport moves the deck", () => {
        const {channel, controller} = startedDisplay();
        const added = fakeTransport();
        channel.addTransport(added);
        added.deliver(nextMessage());
        assert.deepEqual(controller.calls, [["moveToNext"]]);
    });

    test("dispose removes every listener it added", () => {
        const {channel, transport, player, controller, host} = startedDisplay();
        const added = fakeTransport();
        channel.addTransport(added);
        channel.dispose();
        assert.equal(transport.handlers.size, 0);
        assert.equal(added.handlers.size, 0);
        assert.equal(added.disposed, true);
        assert.equal(host.listeners.size, 0);
        assert.equal(player.listenerCount(PlayerEvents.frameChange), 0);
        assert.equal(player.listenerCount(PlayerEvents.blankScreenChange), 0);
        for (const name of ["zoom", "translate", "rotate"]) {
            assert.equal(controller.listenerCount(PlayerControllerEvents[name]), 0, name);
        }
    });

    test("a cameraMove zooms and pans the display in its own pixels", () => {
        const {transport, controller} = startedDisplay();
        transport.deliver(cameraMoveMessage({x: -0.1, y: 0.2, zoom: 2, atX: 0.25, atY: 0.75}));
        assert.deepEqual(controller.calls, [
            ["zoom", 2, 0.25 * 1200, 0.75 * 400],
            ["translate", -0.1 * 1200, 0.2 * 400]
        ]);
    });

    test("a cameraMove that only pans, or only zooms, makes that move alone", () => {
        const {transport, controller} = startedDisplay();
        transport.deliver(cameraMoveMessage({x: 0.5, y: 0, zoom: 1, atX: 0, atY: 0}));
        transport.deliver(cameraMoveMessage({x: 0, y: 0, zoom: 1.05, atX: 0.5, atY: 0.5}));
        assert.deepEqual(controller.calls, [
            ["translate", 600, 0],
            ["zoom", 1.05, 600, 200]
        ]);
    });

    test("each zoom and pan of the display, its own mouse included, is reported as camera", () => {
        const {transport, controller} = startedDisplay();
        controller.zoom(2, 300, 300);
        controller.translate(-120, 40);
        const zoomed = composeView(ON_FRAME, {x: 0, y: 0, zoom: 2, atX: 0.25, atY: 0.75});
        const panned = composeView(zoomed, {x: -0.1, y: 0.1, zoom: 1, atX: 0, atY: 0});
        assert.deepEqual(transport.sent, [cameraMessage(zoomed), cameraMessage(panned)]);
    });

    test("a rotation marks the camera off its frame and leaves the view as it was", () => {
        const {transport, controller} = startedDisplay();
        controller.emit(PlayerControllerEvents.rotate, 5);
        assert.deepEqual(transport.sent, [cameraMessage({...ON_FRAME, offFrame: true})]);
    });

    test("a hello carries the camera as it is now", () => {
        const {channel, controller} = startedDisplay();
        controller.translate(-120, 0);
        assert.deepEqual(/** @type {any} */ (channel.hello).camera, {
            offFrame: true,
            zoom: 1,
            x: -0.1,
            y: 0
        });
    });

    test("a cameraReset moves back to the current frame", () => {
        const {transport, player, controller} = startedDisplay();
        transport.deliver(cameraResetMessage());
        assert.deepEqual(player.calls, [["moveToFrame", frames[0]]]);
        assert.deepEqual(controller.calls, []);
    });

    test("a frame change puts the camera back on its frame and reports it", () => {
        const {transport, player, controller, timer} = startedDisplay();
        timer.start();
        controller.translate(-120, 0);
        transport.sent.length = 0;
        player.showFrame(1);
        assert.deepEqual(transport.sent, [
            frameChangeMessage({index: 1, id: "f2", title: "Two", notes: "second"}),
            cameraMessage(ON_FRAME)
        ]);
    });

    test("a return to the same frame is not a move in the talk: the timer stays stopped", () => {
        const {transport, player, controller, timer} = startedDisplay();
        controller.translate(-120, 0);
        transport.sent.length = 0;
        player.showFrame(0);
        assert.equal(timer.state.running, false);
        assert.deepEqual(transport.sent, [frameChangeMessage(firstFrame), cameraMessage(ON_FRAME)]);
        player.showFrame(1);
        assert.equal(timer.state.running, true);
    });

    test("a preview reports its gestures as cameraMove", () => {
        const {transport, previews} = startedDisplay();
        transport.deliver(previewMessage(true));
        const move = {x: -0.1, y: 0, zoom: 1, atX: 0, atY: 0};
        previews[0].onCamera(move);
        assert.deepEqual(transport.sent, [cameraMoveMessage(move)]);
    });

    test("a preview shows a camera on its own frame, then its view, in its own pixels", () => {
        const {transport, player, controller} = startedDisplay();
        transport.deliver(previewMessage(true));
        transport.deliver(cameraMessage({offFrame: true, zoom: 1.5, x: 0.1, y: -0.2}));
        assert.deepEqual(player.calls, [["jumpToFrame", frames[0]]]);
        assert.deepEqual(controller.viewport.calls, [
            ["zoom", 1.5, 0, 0],
            ["translate", 0.1 * 1200, -0.2 * 400]
        ]);
        assert.deepEqual(controller.calls, []);
    });

    test("a camera outside preview mode is ignored", () => {
        const {transport, player, controller} = startedDisplay();
        transport.deliver(cameraMessage({offFrame: true, zoom: 1.5, x: 0.1, y: -0.2}));
        assert.deepEqual(player.calls, []);
        assert.deepEqual(controller.viewport.calls, []);
    });
});
