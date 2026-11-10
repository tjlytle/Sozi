import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {TransportEvents, TransportStatus} from "../../../src/js/protocol/LocalTransport.js";
import {TransportSet} from "../../../src/js/protocol/TransportSet.js";

/** Stand-in for a transport: it records what is sent and delivers what a test posts.
 *
 * @param {string} [status] - Its status.
 * @returns {any} - The fake transport.
 */
function fakeTransport(status = TransportStatus.connected) {
    const transport = /** @type {any} */ (new EventEmitter());
    return Object.assign(transport, {
        status,
        sent: [],
        handlers: new Set(),
        disposed: false,
        send(message) {
            transport.sent.push(message);
            return true;
        },
        onMessage(handler) {
            transport.handlers.add(handler);
            return () => transport.handlers.delete(handler);
        },
        setStatus(next) {
            transport.status = next;
            transport.emit(TransportEvents.statusChange, next);
        },
        dispose() {
            transport.disposed = true;
        }
    });
}

describe("TransportSet", () => {
    test("broadcast reaches every member", () => {
        const set = new TransportSet();
        const a = fakeTransport();
        const b = fakeTransport();
        set.add(a);
        set.add(b);
        set.broadcast({name: "x"});
        assert.deepEqual(a.sent, [{name: "x"}]);
        assert.deepEqual(b.sent, [{name: "x"}]);
    });

    test("the primary is the most recently added connected member", () => {
        const set = new TransportSet();
        const a = fakeTransport();
        const b = fakeTransport();
        set.add(a);
        set.add(b);
        assert.equal(set.sendToPrimary({name: "one"}), true);
        assert.deepEqual(a.sent, []);
        assert.deepEqual(b.sent, [{name: "one"}]);

        b.setStatus(TransportStatus.closed);
        set.sendToPrimary({name: "two"});
        assert.deepEqual(a.sent, [{name: "two"}]);
        assert.deepEqual(b.sent, [{name: "one"}]);
    });

    test("with no connected member nothing is sent", () => {
        const set = new TransportSet();
        assert.equal(set.sendToPrimary({name: "x"}), false);
        const closed = fakeTransport(TransportStatus.closed);
        set.add(closed);
        assert.equal(set.sendToPrimary({name: "x"}), false);
        assert.deepEqual(closed.sent, []);
    });

    test("a handler hears every member and is told which one", () => {
        const set = new TransportSet();
        const a = fakeTransport();
        const heard = [];
        const stop = set.onMessage((data, from) => heard.push([data, from]));
        set.add(a);
        const b = fakeTransport();
        set.add(b);
        [...a.handlers][0]("from a");
        [...b.handlers][0]("from b");
        assert.deepEqual(heard, [
            ["from a", a],
            ["from b", b]
        ]);
        stop();
        [...a.handlers][0]("after");
        assert.equal(heard.length, 2);
    });

    test("the status is the best of its members, closed when it has none", () => {
        const set = new TransportSet();
        assert.equal(set.status, TransportStatus.closed);
        const a = fakeTransport(TransportStatus.closed);
        const b = fakeTransport("stale");
        set.add(a);
        assert.equal(set.status, TransportStatus.closed);
        set.add(b);
        assert.equal(set.status, "stale");
        b.setStatus("reconnecting");
        assert.equal(set.status, "reconnecting");
        a.setStatus(TransportStatus.connected);
        assert.equal(set.status, TransportStatus.connected);
    });

    test("statusChange fires only when the combined status changes", () => {
        const set = new TransportSet();
        const changes = [];
        set.on(TransportEvents.statusChange, status => changes.push(status));
        const a = fakeTransport();
        const b = fakeTransport();
        set.add(a);
        set.add(b);
        assert.deepEqual(changes, [TransportStatus.connected]);
        b.setStatus(TransportStatus.closed);
        assert.deepEqual(changes, [TransportStatus.connected]);
        a.setStatus(TransportStatus.closed);
        assert.deepEqual(changes, [TransportStatus.connected, TransportStatus.closed]);
    });

    test("dispose removes every listener and disposes its members", () => {
        const set = new TransportSet();
        const a = fakeTransport();
        set.add(a);
        set.on(TransportEvents.statusChange, () => {});
        set.dispose();
        assert.equal(a.handlers.size, 0);
        assert.equal(a.listenerCount(TransportEvents.statusChange), 0);
        assert.equal(a.disposed, true);
        assert.equal(set.listenerCount(TransportEvents.statusChange), 0);
        assert.equal(set.sendToPrimary({name: "x"}), false);
    });
});
