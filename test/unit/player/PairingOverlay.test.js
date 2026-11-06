import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {PairingOverlay} from "../../../src/js/player/PairingOverlay.js";

/** Stand-in for the overlay's element.
 *
 * @returns {any} - The fake element; `children` counts what a render left in it.
 */
function fakeElement() {
    return {
        hidden: true,
        children: 0,
        replaceChildren() {
            this.children = 0;
        }
    };
}

/** Stand-in for the window: it holds the keydown listeners and presses keys.
 *
 * @returns {any} - The fake host.
 */
function fakeHost() {
    const listeners = new Set();
    return {
        listeners,
        addEventListener(type, listener) {
            assert.equal(type, "keydown");
            listeners.add(listener);
        },
        removeEventListener(type, listener) {
            listeners.delete(listener);
        },
        press(key, modifiers = {}) {
            const evt = {
                key,
                prevented: false,
                preventDefault() {
                    this.prevented = true;
                },
                ...modifiers
            };
            for (const listener of listeners) {
                listener(evt);
            }
            return evt;
        }
    };
}

/** An overlay on fakes, and a pairing that counts its renders.
 *
 * @returns {any} - The overlay, its parts and the pairing.
 */
function overlayWithPairing() {
    const element = fakeElement();
    const host = fakeHost();
    const display = {};
    const overlay = new PairingOverlay(element, host, display);
    const pairing = {
        renders: /** @type {any[][]} */ ([]),
        render(target, api) {
            pairing.renders.push([target, api]);
            target.children++;
        }
    };
    overlay.setPairing(pairing);
    return {overlay, element, host, display, pairing};
}

describe("PairingOverlay", () => {
    test("without a pairing Q does nothing", () => {
        const element = fakeElement();
        const host = fakeHost();
        new PairingOverlay(element, host, {});
        const evt = host.press("q");
        assert.equal(element.hidden, true);
        assert.equal(evt.prevented, false);
    });

    test("Q renders the pairing on each show and clears it on hide", () => {
        const {element, host, display, pairing} = overlayWithPairing();
        host.press("q");
        assert.equal(element.hidden, false);
        assert.deepEqual(pairing.renders, [[element, display]]);
        assert.equal(element.children, 1);

        host.press("Q");
        assert.equal(element.hidden, true);
        assert.equal(element.children, 0);

        host.press("q");
        assert.equal(pairing.renders.length, 2);
    });

    test("Escape hides it only while it is shown", () => {
        const {element, host} = overlayWithPairing();
        assert.equal(host.press("Escape").prevented, false);
        host.press("q");
        assert.equal(host.press("Escape").prevented, true);
        assert.equal(element.hidden, true);
    });

    test("Q with Ctrl, Alt or Meta is left to the browser", () => {
        const {element, host} = overlayWithPairing();
        for (const modifier of ["ctrlKey", "altKey", "metaKey"]) {
            host.press("q", {[modifier]: true});
            assert.equal(element.hidden, true, modifier);
        }
    });

    test("dispose hides it and removes its listener", () => {
        const {overlay, element, host} = overlayWithPairing();
        host.press("q");
        overlay.dispose();
        assert.equal(element.hidden, true);
        assert.equal(host.listeners.size, 0);
    });
});
