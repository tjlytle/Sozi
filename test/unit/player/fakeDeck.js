// Fakes of a deck's player, controller, transport and window, for the tests of the display
// side of the protocol: DisplayChannel.test.js and DisplayCommands.test.js.

import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {PlayerEvents} from "../../../src/js/player/playerEvents.js";
import {PlayerControllerEvents} from "../../../src/js/player/PlayerController.js";

/** The deck's two frames, as the player holds them. */
export const frames = Object.freeze([
    {index: 0, frameId: "f1", title: "One", notes: "first"},
    {index: 1, frameId: "f2", title: "Two", notes: "second"}
]);

/** Stand-in for the player: the current frame, the blank screen and the moves it makes.
 *
 * @returns {any} - The fake player; `calls` lists each move.
 */
export function fakePlayer() {
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
export function fakeController(player) {
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
export function fakeTransport() {
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
export function fakeHost() {
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
