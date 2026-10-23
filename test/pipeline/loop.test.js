// test/pipeline/loop.test.js
import {test} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {emptyState} from "../../pipeline/lib/state.js";
import {createControl, drain, hookSignals, sessionNames} from "../../pipeline/lib/loop.js";

/**
 * A state with one issue session and one spawn.
 *
 * @returns {any} - The state.
 */
function busyState() {
    /** @type {any} */
    const state = emptyState();
    state.issues[75] = {session: {container: "sozi-75-build", stage: "build"}};
    state.issues[80] = {session: null};
    state.run.sessions = [{container: "sozi-120-spawn", persona: "advocate", issue: 120}];
    return state;
}

/**
 * A control on a fake clock, recording what it saves, logs and exits with.
 *
 * @param {any} state - The loop state.
 * @returns {any} - The control, the clock and the records.
 */
function fakeControl(state) {
    /** @type {any} */
    const h = {
        t: 0,
        saves: 0,
        exits: /** @type {number[]} */ ([]),
        lines: /** @type {string[]} */ ([])
    };
    h.control = createControl({
        sleep: async () => {},
        save: () => void h.saves++,
        exit: code => void h.exits.push(code),
        log: line => void h.lines.push(line),
        state,
        now: () => h.t
    });
    return h;
}

test("sessionNames lists issue sessions and spawns", () => {
    assert.deepEqual(sessionNames(busyState()), [
        "#75 build (sozi-75-build)",
        "spawn #120 (sozi-120-spawn)"
    ]);
    const state = emptyState();
    state.run.sessions = [{container: "c1", persona: "ops", issue: null}];
    assert.deepEqual(sessionNames(state), ["spawn ops (c1)"]);
});

test("a repeat signal within a second is the same press", () => {
    const h = fakeControl(busyState());
    h.control.interrupt();
    assert.equal(h.control.stopping, true);
    h.t = 999;
    h.control.interrupt();
    assert.deepEqual(h.exits, []);
    h.t = 2000;
    h.control.interrupt();
    assert.deepEqual(h.exits, [130]);
    assert.equal(h.saves, 1);
    assert.match(h.lines.at(-1) ?? "", /#75 build \(sozi-75-build\), spawn #120/);
});

test("hookSignals passes SIGINT and SIGTERM to the handler until the unhook", () => {
    const proc = new EventEmitter();
    /** @type {string[]} */
    const seen = [];
    const unhook = hookSignals(signal => void seen.push(signal), proc);
    proc.emit("SIGINT", "SIGINT");
    proc.emit("SIGTERM", "SIGTERM");
    unhook();
    proc.emit("SIGINT", "SIGINT");
    proc.emit("SIGTERM", "SIGTERM");
    assert.deepEqual(seen, ["SIGINT", "SIGTERM"]);
    assert.equal(proc.listenerCount("SIGINT") + proc.listenerCount("SIGTERM"), 0);
});

test("drain names the sessions it waits for and returns once they clear", async () => {
    const state = busyState();
    const h = fakeControl(state);
    let passes = 0;
    await drain(
        async () => {
            passes++;
            state.issues[75].session = null;
            state.run.sessions = [];
            return /** @type {any} */ ({});
        },
        state,
        h.control,
        line => void h.lines.push(line)
    );
    assert.equal(passes, 1);
    assert.equal(h.control.draining, true);
    assert.deepEqual(h.lines, [
        "waiting for #75 build (sozi-75-build), spawn #120 (sozi-120-spawn); signal again to leave them"
    ]);
});
