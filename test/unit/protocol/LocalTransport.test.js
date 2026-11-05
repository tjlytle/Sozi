import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    LocalTransport,
    TransportEvents,
    TransportStatus
} from "../../../src/js/protocol/LocalTransport.js";

/** Create a stand-in for a browser window.
 *
 * It records what is posted to it, keeps its message listeners and intervals, and can
 * deliver a message event as if another window had posted it.
 *
 * @returns {any} - The fake window.
 */
function fakeWindow() {
    const listeners = new Set();
    const intervals = new Map();
    let nextId = 1;
    return {
        closed: false,
        posted: [],
        listeners,
        intervals,
        postMessage(message, origin) {
            this.posted.push([message, origin]);
        },
        addEventListener(type, listener) {
            assert.equal(type, "message");
            listeners.add(listener);
        },
        removeEventListener(type, listener) {
            assert.equal(type, "message");
            listeners.delete(listener);
        },
        setInterval(callback, ms) {
            intervals.set(nextId, {callback, ms});
            return nextId++;
        },
        clearInterval(id) {
            intervals.delete(id);
        },
        deliver(data, source) {
            for (const listener of listeners) {
                listener({data, source});
            }
        },
        tick() {
            for (const {callback} of intervals.values()) {
                callback();
            }
        }
    };
}

describe("LocalTransport", () => {
    test("posts to its target with any origin", () => {
        const host = fakeWindow();
        const target = fakeWindow();
        const transport = new LocalTransport(host, target);
        transport.send({name: "next", transition: true});
        assert.deepEqual(target.posted, [[{name: "next", transition: true}, "*"]]);
        assert.deepEqual(host.posted, []);
    });

    test("hands on messages from its target and ignores other sources", () => {
        const host = fakeWindow();
        const target = fakeWindow();
        const transport = new LocalTransport(host, target);
        const received = [];
        transport.onMessage(data => received.push(data));
        host.deliver({name: "blank", on: true}, target);
        host.deliver({name: "blank", on: false}, fakeWindow());
        host.deliver({name: "blank", on: false}, host);
        host.deliver({name: "blank", on: false}, null);
        assert.deepEqual(received, [{name: "blank", on: true}]);
    });

    test("bound to its own window, it never posts but still hands on what the page posts", () => {
        const host = fakeWindow();
        const transport = new LocalTransport(host, host);
        const received = [];
        transport.onMessage(data => received.push(data));
        assert.equal(transport.send({name: "next", transition: true}), false);
        host.deliver({name: "next"}, host);
        assert.deepEqual(host.posted, []);
        assert.deepEqual(received, [{name: "next"}]);
        assert.equal(host.intervals.size, 0);
    });

    test("is open until its target closes, checked once a second", () => {
        const host = fakeWindow();
        const target = fakeWindow();
        const transport = new LocalTransport(host, target);
        const changes = [];
        transport.on(TransportEvents.statusChange, status => changes.push(status));
        assert.equal(transport.status, TransportStatus.open);
        assert.deepEqual(
            Array.from(host.intervals.values(), i => i.ms),
            [1000]
        );
        host.tick();
        assert.deepEqual(changes, []);
        target.closed = true;
        host.tick();
        host.tick();
        assert.equal(transport.status, TransportStatus.closed);
        assert.deepEqual(changes, [TransportStatus.closed]);
    });

    test("finds a closed target on send and posts nothing", () => {
        const host = fakeWindow();
        const target = fakeWindow();
        const transport = new LocalTransport(host, target);
        const changes = [];
        transport.on(TransportEvents.statusChange, status => changes.push(status));
        target.closed = true;
        assert.equal(transport.send({name: "next", transition: true}), false);
        assert.deepEqual(target.posted, []);
        assert.deepEqual(changes, [TransportStatus.closed]);
    });

    test("onMessage returns a function that removes the handler", () => {
        const host = fakeWindow();
        const target = fakeWindow();
        const transport = new LocalTransport(host, target);
        const received = [];
        const off = transport.onMessage(data => received.push(data));
        off();
        host.deliver({name: "next"}, target);
        assert.deepEqual(received, []);
    });

    test("dispose removes its listener and its timer", () => {
        const host = fakeWindow();
        const target = fakeWindow();
        const transport = new LocalTransport(host, target);
        const received = [];
        transport.onMessage(data => received.push(data));
        transport.dispose();
        assert.equal(host.listeners.size, 0);
        assert.equal(host.intervals.size, 0);
        assert.equal(transport.listenerCount(TransportEvents.message), 0);
        assert.equal(transport.send({name: "next", transition: true}), false);
        assert.deepEqual(target.posted, []);
    });
});
