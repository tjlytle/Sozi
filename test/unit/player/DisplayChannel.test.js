import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {DisplayChannel, DisplayChannelEvents} from "../../../src/js/player/DisplayChannel.js";
import {PlayerEvents} from "../../../src/js/player/playerEvents.js";
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
    followLinkMessage
} from "../../../src/js/protocol/messages.js";
import {viewportMessage} from "../../../src/js/protocol/viewport.js";

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

/** Stand-in for the player controller: it records each method called on it.
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
    return {
        calls,
        moveToNext: record("moveToNext"),
        jumpToNext: record("jumpToNext"),
        moveToPrevious: record("moveToPrevious"),
        jumpToPrevious: record("jumpToPrevious"),
        moveToFrame: record("moveToFrame"),
        jumpToFrame: record("jumpToFrame"),
        toggleBlankScreen() {
            calls.push(["toggleBlankScreen"]);
            player.setBlank(!player.blankScreenIsVisible);
        }
    };
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
        send(message) {
            this.sent.push(message);
            return true;
        },
        onMessage(handler) {
            this.handlers.add(handler);
            return () => this.handlers.delete(handler);
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
 * @returns {any} - The channel and its fakes.
 */
function startedDisplay() {
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
    const channel = new DisplayChannel({
        player,
        controller,
        presentation,
        transport,
        host,
        enterPreviewMode: (current, onFollowLink) => previews.push({current, onFollowLink})
    });
    channel.start();
    const startSent = transport.sent.splice(0);
    return {channel, player, controller, transport, host, links, previews, startSent};
}

const firstFrame = {index: 0, id: "f1", title: "One", notes: "first"};
const viewport = {width: 1200, height: 400, pixelRatio: 2};

/** The hello a display sends in the given state.
 *
 * @param {object} changes - The fields that differ from the first frame, not blank.
 * @returns {object} - The message.
 */
function displayHello(changes = {}) {
    return helloMessage(Roles.display, {
        deckId: "basic",
        frameCount: 2,
        viewport,
        frame: firstFrame,
        blank: false,
        ...changes
    });
}

describe("DisplayChannel", () => {
    test("sends a display hello and the old loaded message on start", () => {
        const {startSent} = startedDisplay();
        assert.deepEqual(startSent, [displayHello(), {name: "loaded", length: 2}]);
    });

    test("answers a surface hello with its current frame and blank state", () => {
        const {transport, player} = startedDisplay();
        player.showFrame(1);
        player.setBlank(true);
        transport.sent.length = 0;
        transport.deliver(helloMessage(Roles.surface));
        assert.deepEqual(transport.sent, [
            displayHello({frame: {index: 1, id: "f2", title: "Two", notes: "second"}, blank: true})
        ]);
    });

    test("answers the old notifyOnFrameChange as a surface hello", () => {
        const {transport} = startedDisplay();
        transport.deliver({name: "notifyOnFrameChange"});
        assert.deepEqual(transport.sent, [displayHello()]);
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
            viewportMessage({innerWidth: 800, innerHeight: 600, devicePixelRatio: 2}),
            blankMessage(true),
            blankMessage(false)
        ]);
    });

    test("sends each frame change once however many surfaces said hello", () => {
        const {transport, player} = startedDisplay();
        transport.deliver(helloMessage(Roles.surface));
        transport.deliver(helloMessage(Roles.surface));
        transport.sent.length = 0;
        player.showFrame(1);
        assert.equal(transport.sent.length, 1);
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
        assert.deepEqual(controller.calls, [
            ["moveToNext"],
            ["jumpToFrame", 1],
            ["jumpToFrame", 1],
            ["toggleBlankScreen"]
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

    test("enters preview mode once", () => {
        const {transport, previews} = startedDisplay();
        transport.deliver(previewMessage(false));
        transport.deliver(previewMessage(true));
        assert.equal(previews.length, 1);
    });

    test("dispose removes every listener it added", () => {
        const {channel, transport, player, host} = startedDisplay();
        channel.dispose();
        assert.equal(transport.handlers.size, 0);
        assert.equal(host.listeners.size, 0);
        assert.equal(player.listenerCount(PlayerEvents.frameChange), 0);
        assert.equal(player.listenerCount(PlayerEvents.blankScreenChange), 0);
    });
});
