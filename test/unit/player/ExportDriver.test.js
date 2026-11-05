import {test, describe, beforeEach, afterEach} from "node:test";
import assert from "node:assert/strict";
import {fakeRequestAnimationFrame} from "../support/stubs.js";
import {ExportDriver} from "../../../src/js/player/ExportDriver.js";

/** A deck of two frames shown through two cameras, with a player that records its calls.
 *
 * @returns {{player: object, presentation: object, viewport: object, calls: Array}} - The fakes and the calls made on them.
 */
function fakeDeck() {
    const calls = [];
    const lp = {
        transitionTimingFunction: "linear",
        transitionRelativeZoom: 0,
        transitionPath: null
    };
    const frames = [
        {index: 0, transitionDurationMs: 500, layerProperties: [lp, lp]},
        {index: 1, transitionDurationMs: 1200, layerProperties: [lp, lp]}
    ];
    const player = {
        transitions: ["stale"],
        targetFrame: frames[0],
        pause: () => calls.push(["pause"]),
        setupTransition: (camera, ...args) => calls.push(["setupTransition", camera, ...args]),
        onAnimatorStep: progress => calls.push(["onAnimatorStep", progress]),
        jumpToFrame: index => calls.push(["jumpToFrame", index])
    };
    const viewport = {
        cameras: [{layer: {index: 0}}, {layer: {index: 1}}],
        repaint: () => calls.push(["repaint"])
    };
    return {player, presentation: {frames}, viewport, calls};
}

describe("ExportDriver", () => {
    const raf = fakeRequestAnimationFrame();
    beforeEach(() => raf.install());
    afterEach(() => raf.uninstall());

    test("setup returns the target frame's duration and sets up one transition per camera", () => {
        const {player, presentation, viewport, calls} = fakeDeck();
        const driver = new ExportDriver(player, presentation, viewport);
        assert.equal(driver.setup(1), 1200);
        assert.equal(player.targetFrame, presentation.frames[1]);
        assert.deepEqual(player.transitions, []);
        assert.deepEqual(
            calls.map(c => c[0]),
            ["pause", "setupTransition", "setupTransition"]
        );
        assert.deepEqual(
            calls.slice(1).map(c => c[1]),
            viewport.cameras
        );
    });

    test("step forwards the progress to the player", () => {
        const {player, presentation, viewport, calls} = fakeDeck();
        new ExportDriver(player, presentation, viewport).step(0.25);
        assert.deepEqual(calls, [["onAnimatorStep", 0.25]]);
    });

    test("finish jumps to the target frame and returns its index", () => {
        const {player, presentation, viewport, calls} = fakeDeck();
        const driver = new ExportDriver(player, presentation, viewport);
        driver.setup(1);
        calls.length = 0;
        assert.equal(driver.finish(), 1);
        assert.deepEqual(player.transitions, []);
        assert.deepEqual(calls, [["jumpToFrame", 1]]);
    });

    test("kick(true) twice runs only one repaint loop", () => {
        const {player, presentation, viewport, calls} = fakeDeck();
        const driver = new ExportDriver(player, presentation, viewport);
        driver.kick(true);
        driver.kick(true);
        assert.equal(calls.length, 1);
        raf.tick(16);
        assert.equal(calls.length, 2);
        driver.kick(false);
        raf.tick(16);
        assert.equal(calls.length, 2);
    });

    test("dispose stops the repaint loop", () => {
        const {player, presentation, viewport, calls} = fakeDeck();
        const driver = new ExportDriver(player, presentation, viewport);
        driver.kick(true);
        driver.dispose();
        raf.tick(16);
        raf.tick(16);
        assert.deepEqual(calls, [["repaint"]]);
    });
});
