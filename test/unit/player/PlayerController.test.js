import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {PlayerController} from "../../../src/js/player/PlayerController.js";

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

/** Stand-in for a controller: it records the navigation methods called on it.
 *
 * @param {boolean} enabled - Is keyboard navigation enabled?
 * @returns {any} - The fake; `calls` lists the method names called.
 */
function fakeController(enabled) {
    const calls = [];
    const fake = {calls, presentation: {enableKeyboardNavigation: enabled}};
    for (const verb of ["jumpTo", "moveTo"]) {
        for (const direction of ["First", "Last", "Previous", "Next"]) {
            fake[verb + direction] = () => calls.push(verb + direction);
        }
    }
    return fake;
}

/** A keydown event that records whether it was stopped.
 *
 * @param {number} keyCode - The key code.
 * @param {object} [fields] - Modifier flags and the target.
 * @returns {any} - The fake event; `stopped` and `prevented` tell what the handler did.
 */
function keyDown(keyCode, fields = {}) {
    const evt = {
        keyCode,
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

/** Press a key on a fake controller.
 *
 * @param {any} controller - The fake controller.
 * @param {any} evt - The fake event.
 */
function press(controller, evt) {
    PlayerController.prototype.onKeyDown.call(controller, evt);
}

describe("PlayerController onKeyDown", () => {
    test("each navigation key moves with a transition, and keeps the key", () => {
        for (const [keyCode, direction] of NAVIGATION) {
            const controller = fakeController(true);
            const evt = keyDown(keyCode);
            press(controller, evt);
            assert.deepEqual(controller.calls, ["moveTo" + direction], String(keyCode));
            assert.equal(evt.stopped && evt.prevented, true, String(keyCode));
        }
    });

    test("Shift jumps without a transition", () => {
        for (const [keyCode, direction] of NAVIGATION) {
            const controller = fakeController(true);
            press(controller, keyDown(keyCode, {shiftKey: true}));
            assert.deepEqual(controller.calls, ["jumpTo" + direction], String(keyCode));
        }
    });

    test("with keyboard navigation off, a navigation key moves nothing but is still kept", () => {
        for (const [keyCode] of NAVIGATION) {
            const controller = fakeController(false);
            const evt = keyDown(keyCode);
            press(controller, evt);
            assert.deepEqual(controller.calls, [], String(keyCode));
            assert.equal(evt.stopped && evt.prevented, true, String(keyCode));
        }
    });

    test("Alt, Ctrl and Meta leave the key to the browser", () => {
        for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
            const controller = fakeController(true);
            const evt = keyDown(32, {[modifier]: true});
            press(controller, evt);
            assert.deepEqual(controller.calls, [], modifier);
            assert.equal(evt.stopped || evt.prevented, false, modifier);
        }
    });

    test("a key typed into a field in the deck is left to the field", () => {
        const controller = fakeController(true);
        const evt = keyDown(32, {target: {localName: "input", type: "text"}});
        press(controller, evt);
        assert.deepEqual(controller.calls, []);
        assert.equal(evt.stopped || evt.prevented, false);
    });

    test("any other key is left alone", () => {
        for (const keyCode of [65, 27, 9, 116]) {
            const controller = fakeController(true);
            const evt = keyDown(keyCode);
            press(controller, evt);
            assert.deepEqual(controller.calls, [], String(keyCode));
            assert.equal(evt.stopped || evt.prevented, false, String(keyCode));
        }
    });
});
