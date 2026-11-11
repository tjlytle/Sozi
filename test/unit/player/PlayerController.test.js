import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {PlayerController} from "../../../src/js/player/PlayerController.js";
import {fakeTarget, fakeRoot} from "./fakeInput.js";

/** Stand-in for a player whose viewport shows a deck on a fake SVG root.
 *
 * @param {boolean} editMode - Is the viewport in the editor?
 * @returns {any} - The fake player; `root` is its SVG root.
 */
function fakePlayer(editMode) {
    const root = fakeRoot();
    return {root, viewport: {editMode, svgRoot: root}};
}

describe("PlayerController", () => {
    test("in the player, listens for keys on the window it is given", () => {
        const keyTarget = fakeTarget();
        const controller = new PlayerController(fakePlayer(false), keyTarget);
        assert.ok(controller.keys);
        assert.equal(keyTarget.count(), 2);
    });

    test("in the editor, listens for no keys", () => {
        const keyTarget = fakeTarget();
        const controller = new PlayerController(fakePlayer(true), keyTarget);
        assert.equal(controller.keys, null);
        assert.equal(keyTarget.count(), 0);
    });

    test("each load replaces the mouse of the load before", () => {
        const player = fakePlayer(true);
        const controller = new PlayerController(player, fakeTarget());
        controller.onLoad();
        const first = controller.mouse;
        const once = player.root.count();
        controller.onLoad();
        assert.notEqual(controller.mouse, first);
        assert.equal(player.root.count(), once);
    });

    test("dispose removes the mouse and the keys", () => {
        const player = fakePlayer(false);
        const keyTarget = fakeTarget();
        const controller = new PlayerController(player, keyTarget);
        controller.onLoad();
        controller.dispose();
        assert.equal(player.root.count(), 0);
        assert.equal(keyTarget.count(), 0);
    });

    test("dispose before any load removes the keys", () => {
        const keyTarget = fakeTarget();
        const controller = new PlayerController(fakePlayer(false), keyTarget);
        controller.dispose();
        assert.equal(keyTarget.count(), 0);
    });
});
