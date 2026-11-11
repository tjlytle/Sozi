import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {PlayerKeys} from "../../../src/js/player/PlayerKeys.js";
import {SCALE_FACTOR, ROTATE_STEP} from "../../../src/js/player/controlSteps.js";
import {fakeTarget} from "./fakeInput.js";

/** The key codes `onKeyDown` handles, with the direction each one moves.
 *
 * @type {Array<[number, string]>}
 */
const NAVIGATION = [
    [36, "First"], // Home
    [35, "Last"], // End
    [38, "Previous"], // Arrow up
    [33, "Previous"], // Page up
    [37, "Previous"], // Arrow left
    [40, "Next"], // Arrow down
    [34, "Next"], // Page down
    [39, "Next"], // Arrow right
    [13, "Next"], // Enter
    [32, "Next"] // Space
];

/** Stand-in for a controller: it records the actions called on it.
 *
 * @param {object} [settings] - The presentation's keyboard settings; all on by default.
 * @returns {any} - The fake; `calls` lists each action with its arguments.
 */
function fakeController(settings = {}) {
    const calls = [];
    const fake = {
        calls,
        viewport: {width: 400, height: 200},
        presentation: {
            enableKeyboardNavigation: true,
            enableKeyboardZoom: true,
            enableKeyboardRotation: true,
            ...settings
        }
    };
    const actions = ["zoom", "rotate", "togglePause", "viewAll", "toggleBlankScreen"];
    for (const verb of ["jumpTo", "moveTo"]) {
        for (const direction of ["First", "Last", "Previous", "Next", "Current"]) {
            actions.push(verb + direction);
        }
    }
    for (const action of actions) {
        fake[action] = (...args) => calls.push([action, ...args]);
    }
    return fake;
}

/** A key event that records whether it was stopped.
 *
 * @param {object} fields - The key code or char code, modifier flags and the target.
 * @returns {any} - The fake event; `stopped` and `prevented` tell what the handler did.
 */
function key(fields) {
    const evt = {
        keyCode: 0,
        charCode: 0,
        which: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        target: null,
        stopped: false,
        prevented: false,
        ...fields
    };
    evt.stopPropagation = () => (evt.stopped = true);
    evt.preventDefault = () => (evt.prevented = true);
    return evt;
}

/** Keys on a fake controller and a fake window.
 *
 * @param {object} [settings] - The presentation's keyboard settings.
 * @returns {any} - The keys, the controller and the target.
 */
function keysOn(settings) {
    const controller = fakeController(settings);
    const target = fakeTarget();
    const keys = new PlayerKeys(controller, target);
    return {keys, controller, target};
}

/** Press a key down on the window.
 *
 * @param {any} target - The fake window.
 * @param {number} keyCode - The key code.
 * @param {object} [fields] - Modifier flags and the target.
 * @returns {any} - The event.
 */
function keyDown(target, keyCode, fields = {}) {
    const evt = key({keyCode, ...fields});
    target.fire("keydown", evt);
    return evt;
}

/** Type a character on the window.
 *
 * @param {any} target - The fake window.
 * @param {string} char - The character.
 * @param {object} [fields] - Modifier flags and the target.
 * @returns {any} - The event.
 */
function keyPress(target, char, fields = {}) {
    const evt = key({charCode: char.charCodeAt(0), ...fields});
    target.fire("keypress", evt);
    return evt;
}

describe("PlayerKeys onKeyDown", () => {
    test("each navigation key moves with a transition, and keeps the key", () => {
        for (const [keyCode, direction] of NAVIGATION) {
            const {controller, target} = keysOn();
            const evt = keyDown(target, keyCode);
            assert.deepEqual(controller.calls, [["moveTo" + direction]], String(keyCode));
            assert.equal(evt.stopped && evt.prevented, true, String(keyCode));
        }
    });

    test("Shift jumps without a transition", () => {
        for (const [keyCode, direction] of NAVIGATION) {
            const {controller, target} = keysOn();
            keyDown(target, keyCode, {shiftKey: true});
            assert.deepEqual(controller.calls, [["jumpTo" + direction]], String(keyCode));
        }
    });

    test("with keyboard navigation off, a navigation key moves nothing but is still kept", () => {
        for (const [keyCode] of NAVIGATION) {
            const {controller, target} = keysOn({enableKeyboardNavigation: false});
            const evt = keyDown(target, keyCode);
            assert.deepEqual(controller.calls, [], String(keyCode));
            assert.equal(evt.stopped && evt.prevented, true, String(keyCode));
        }
    });

    test("Alt, Ctrl and Meta leave the key to the browser", () => {
        for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
            const {controller, target} = keysOn();
            const evt = keyDown(target, 32, {[modifier]: true});
            assert.deepEqual(controller.calls, [], modifier);
            assert.equal(evt.stopped || evt.prevented, false, modifier);
        }
    });

    test("a key typed into a field in the deck is left to the field", () => {
        const {controller, target} = keysOn();
        const evt = keyDown(target, 32, {target: {localName: "input", type: "text"}});
        assert.deepEqual(controller.calls, []);
        assert.equal(evt.stopped || evt.prevented, false);
    });

    test("any other key is left alone", () => {
        for (const keyCode of [65, 27, 9, 116]) {
            const {controller, target} = keysOn();
            const evt = keyDown(target, keyCode);
            assert.deepEqual(controller.calls, [], String(keyCode));
            assert.equal(evt.stopped || evt.prevented, false, String(keyCode));
        }
    });
});

describe("PlayerKeys onKeyPress", () => {
    test("each character key calls its action and keeps the key", () => {
        /** @type {Array<[string, Array<any>]>} */
        const table = [
            ["+", ["zoom", SCALE_FACTOR, 200, 100]],
            ["-", ["zoom", 1 / SCALE_FACTOR, 200, 100]],
            ["r", ["rotate", ROTATE_STEP]],
            ["R", ["rotate", -ROTATE_STEP]],
            ["p", ["togglePause"]],
            ["P", ["togglePause"]],
            ["a", ["viewAll"]],
            ["A", ["viewAll"]],
            [".", ["toggleBlankScreen"]],
            ["=", ["moveToCurrent"]]
        ];
        for (const [char, call] of table) {
            const {controller, target} = keysOn();
            const evt = keyPress(target, char);
            assert.deepEqual(controller.calls, [call], char);
            assert.equal(evt.stopped && evt.prevented, true, char);
        }
    });

    test("a key reported only in `which` is handled too", () => {
        const {controller, target} = keysOn();
        const evt = key({which: "a".charCodeAt(0)});
        target.fire("keypress", evt);
        assert.deepEqual(controller.calls, [["viewAll"]]);
    });

    test("the deck's settings turn zoom, rotation and the blank screen off", () => {
        /** @type {Array<[string, object]>} */
        const cases = [
            ["+", {enableKeyboardZoom: false}],
            ["-", {enableKeyboardZoom: false}],
            ["r", {enableKeyboardRotation: false}],
            ["R", {enableKeyboardRotation: false}],
            [".", {enableKeyboardNavigation: false}]
        ];
        for (const [char, settings] of cases) {
            const {controller, target} = keysOn(settings);
            const evt = keyPress(target, char);
            assert.deepEqual(controller.calls, [], char);
            assert.equal(evt.stopped && evt.prevented, true, char);
        }
    });

    test("Alt, Ctrl and Meta leave the key to the browser", () => {
        for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
            const {controller, target} = keysOn();
            const evt = keyPress(target, "+", {[modifier]: true});
            assert.deepEqual(controller.calls, [], modifier);
            assert.equal(evt.stopped || evt.prevented, false, modifier);
        }
    });

    test("a key typed into a field in the deck is left to the field", () => {
        const {controller, target} = keysOn();
        const evt = keyPress(target, "a", {target: {localName: "textarea"}});
        assert.deepEqual(controller.calls, []);
        assert.equal(evt.stopped || evt.prevented, false);
    });

    test("any other character is left alone", () => {
        const {controller, target} = keysOn();
        const evt = keyPress(target, "x");
        assert.deepEqual(controller.calls, []);
        assert.equal(evt.stopped || evt.prevented, false);
    });
});

describe("PlayerKeys dispose", () => {
    test("removes both listeners from the window", () => {
        const {keys, controller, target} = keysOn();
        assert.equal(target.count(), 2);
        keys.dispose();
        assert.equal(target.count(), 0);
        keyDown(target, 32);
        assert.deepEqual(controller.calls, []);
    });
});
