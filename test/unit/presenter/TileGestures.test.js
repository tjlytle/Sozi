import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {TileGestures} from "../../../src/js/presenter/TileGestures.js";

/** A target inside the tile of a frame.
 *
 * @param {number} index - The frame's position.
 * @returns {any} - The target.
 */
function tile(index) {
    return {closest: () => ({dataset: {index: String(index)}})};
}

/** A target outside every tile.
 *
 * @type {any}
 */
const outside = {closest: () => null};

/** Gestures on a fake grid and fake timers, with the notes they ask for collected.
 *
 * @returns {any} - The gestures and their fakes; `fire` runs the timer that is set.
 */
function fakeGestures() {
    const grid = new EventTarget();
    const timers = new Map();
    let nextId = 1;
    const host = {
        setTimeout(callback, ms) {
            const id = nextId++;
            timers.set(id, {callback, ms});
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        }
    };
    const notes = [];
    const gestures = new TileGestures(/** @type {any} */ (grid), host, index => notes.push(index));
    const send = (type, fields = {}) => {
        const evt = new Event(type, {cancelable: true});
        Object.defineProperties(
            evt,
            Object.fromEntries(Object.entries(fields).map(([k, value]) => [k, {value}]))
        );
        grid.dispatchEvent(evt);
        return evt;
    };
    const fire = () => {
        const [[id, {callback}]] = timers;
        timers.delete(id);
        callback();
    };
    return {gestures, grid, timers, notes, send, fire};
}

describe("TileGestures", () => {
    test("a touch held for 500 ms asks for its frame's notes", () => {
        const {gestures, timers, notes, send, fire} = fakeGestures();
        send("pointerdown", {pointerType: "touch", target: tile(2)});
        assert.equal([...timers.values()][0].ms, 500);
        fire();
        assert.deepEqual(notes.at(-1), 2);
        assert.equal(gestures.longPressed, true);
    });

    test("a touch lifted sooner is not a long press", () => {
        const {gestures, timers, send} = fakeGestures();
        send("pointerdown", {pointerType: "touch", target: tile(2)});
        send("pointerup");
        assert.equal(timers.size, 0);
        assert.equal(gestures.longPressed, false);
    });

    for (const type of ["scroll", "pointercancel"]) {
        test(`a ${type} cancels a long press`, () => {
            const {gestures, timers, send} = fakeGestures();
            send("pointerdown", {pointerType: "touch", target: tile(2)});
            send(type);
            assert.equal(timers.size, 0);
            assert.equal(gestures.longPressed, false);
        });
    }

    test("a mouse held down is not a long press", () => {
        const {timers, send} = fakeGestures();
        send("pointerdown", {pointerType: "mouse", target: tile(2)});
        assert.equal(timers.size, 0);
    });

    test("a touch outside the tiles is not a long press", () => {
        const {timers, send} = fakeGestures();
        send("pointerdown", {pointerType: "touch", target: outside});
        assert.equal(timers.size, 0);
    });

    test("the next press clears a long press and its notes", () => {
        const {gestures, notes, send, fire} = fakeGestures();
        send("pointerdown", {pointerType: "touch", target: tile(2)});
        fire();
        send("pointerdown", {pointerType: "mouse", target: outside});
        assert.equal(gestures.longPressed, false);
        assert.equal(notes.at(-1), null);
    });

    test("a mouse over a tile asks for its notes, and leaving asks for none", () => {
        const {notes, send} = fakeGestures();
        send("pointerover", {pointerType: "mouse", target: tile(1)});
        assert.equal(notes.at(-1), 1);
        send("pointerout", {pointerType: "mouse", relatedTarget: tile(3)});
        assert.equal(notes.at(-1), 3);
        send("pointerout", {pointerType: "mouse", relatedTarget: null});
        assert.equal(notes.at(-1), null);
    });

    test("a finger has no hover", () => {
        const {notes, send} = fakeGestures();
        send("pointerover", {pointerType: "touch", target: tile(1)});
        send("pointerout", {pointerType: "touch", relatedTarget: null});
        assert.deepEqual(notes, []);
    });

    test("focus asks for notes, a pointer outranks it, and it comes back", () => {
        const {notes, send} = fakeGestures();
        send("focusin", {target: tile(1)});
        assert.equal(notes.at(-1), 1);
        send("pointerover", {pointerType: "mouse", target: tile(2)});
        assert.equal(notes.at(-1), 2);
        send("pointerout", {pointerType: "mouse", relatedTarget: null});
        assert.equal(notes.at(-1), 1);
        send("focusout");
        assert.equal(notes.at(-1), null);
    });

    test("the browser's menu stays away during a press, and only then", () => {
        const {send, fire} = fakeGestures();
        assert.equal(send("contextmenu").defaultPrevented, false);
        send("pointerdown", {pointerType: "touch", target: tile(2)});
        assert.equal(send("contextmenu").defaultPrevented, true);
        fire();
        assert.equal(send("contextmenu").defaultPrevented, true);
    });

    test("dispose stops the timer and every listener", () => {
        const {gestures, timers, notes, send} = fakeGestures();
        send("pointerdown", {pointerType: "touch", target: tile(2)});
        gestures.dispose();
        assert.equal(timers.size, 0);
        const before = notes.length;
        send("pointerover", {pointerType: "mouse", target: tile(1)});
        send("pointerdown", {pointerType: "touch", target: tile(1)});
        assert.equal(notes.length, before);
        assert.equal(timers.size, 0);
    });
});
