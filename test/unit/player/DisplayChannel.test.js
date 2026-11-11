import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {fakeTransport} from "./fakeDeck.js";
import {
    JPEG,
    displayHello,
    everyFrame,
    firstFrame,
    secondFrame,
    startedDisplay
} from "./displayWorld.js";
import {DisplayChannelEvents} from "../../../src/js/player/DisplayChannel.js";
import {PlayerEvents} from "../../../src/js/player/playerEvents.js";
import {PlayerControllerEvents} from "../../../src/js/player/PlayerController.js";
import {
    ON_FRAME,
    cameraMessage,
    cameraMoveMessage,
    cameraResetMessage,
    composeView
} from "../../../src/js/protocol/camera.js";
import {
    Roles,
    helloMessage,
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
import {timerMessage} from "../../../src/js/protocol/timer.js";

describe("DisplayChannel", () => {
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

    test("preview mode reports link clicks as followLink, and nothing else about itself", () => {
        const {transport, player, previews, host} = startedDisplay();
        transport.deliver(previewMessage(true));
        assert.equal(previews.length, 1);
        assert.equal(previews[0].current, true);

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
        const expected = [frameChangeMessage(secondFrame), customMessage("pong", 1)];
        assert.deepEqual(transport.sent, expected);
        assert.deepEqual(added.sent, expected);
    });

    test("each command message reaches its DisplayCommands method, with its fields", () => {
        const {channel, transport} = startedDisplay();
        const calls = [];
        for (const name of [
            "next",
            "previous",
            "jumpToFrame",
            "blank",
            "followLink",
            "moveCamera",
            "resetCamera",
            "showView"
        ]) {
            channel.commands[name] = (...args) => calls.push([name, ...args]);
        }
        const move = {x: 0.5, y: 0, zoom: 1, atX: 0, atY: 0};
        const view = {offFrame: true, zoom: 1.5, x: 0.1, y: -0.2};
        transport.deliver(nextMessage(false));
        transport.deliver(previousMessage(true));
        transport.deliver(jumpToFrameMessage(1, false));
        transport.deliver(blankMessage(true));
        transport.deliver(followLinkMessage("a1"));
        transport.deliver(cameraMoveMessage(move));
        transport.deliver(cameraResetMessage());
        transport.deliver(cameraMessage(view));
        assert.deepEqual(calls, [
            ["next", false],
            ["previous", true],
            ["jumpToFrame", 1, false],
            ["blank", true],
            ["followLink", "a1"],
            ["moveCamera", cameraMoveMessage(move)],
            ["resetCamera"],
            ["showView", cameraMessage(view)]
        ]);
    });

    test("the commands see the deck turn into a preview", () => {
        const {channel, transport} = startedDisplay();
        assert.equal(channel.commands.isPreview(), false);
        transport.deliver(previewMessage(false));
        assert.equal(channel.commands.isPreview(), true);
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
});
