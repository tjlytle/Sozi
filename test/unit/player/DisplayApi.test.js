import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {DisplayApi, DisplayApiEvents} from "../../../src/js/player/DisplayApi.js";
import {DisplayChannelEvents} from "../../../src/js/player/DisplayChannel.js";

/** Stand-in for the display channel: it records what the API hands it.
 *
 * @returns {any} - The fake channel.
 */
function fakeChannel() {
    const channel = /** @type {any} */ (new EventEmitter());
    return Object.assign(channel, {
        transports: [],
        customs: [],
        addTransport(transport) {
            channel.transports.push(transport);
        },
        sendCustom(type, data) {
            channel.customs.push([type, data]);
        }
    });
}

/** Stand-in for the pairing overlay: it records the pairing it was given.
 *
 * @returns {any} - The fake overlay.
 */
function fakeOverlay() {
    return {
        pairing: null,
        setPairing(pairing) {
            this.pairing = pairing;
        }
    };
}

const render = () => {};

describe("DisplayApi", () => {
    test("calls made before start are kept and done at start, in order", () => {
        const api = new DisplayApi();
        const channel = fakeChannel();
        const overlay = fakeOverlay();
        const transport = /** @type {any} */ ({});
        api.registerTransport(transport);
        api.send("hi", 1);
        api.registerPairing({render});
        assert.deepEqual(channel.transports, []);

        api.start(channel, overlay);
        assert.deepEqual(channel.transports, [transport]);
        assert.deepEqual(channel.customs, [["hi", 1]]);
        assert.deepEqual(overlay.pairing, {render});
    });

    test("after start a call is done at once", () => {
        const api = new DisplayApi();
        const channel = fakeChannel();
        api.start(channel, fakeOverlay());
        const transport = /** @type {any} */ ({});
        api.registerTransport(transport);
        api.send("hi", 1);
        assert.deepEqual(channel.transports, [transport]);
        assert.deepEqual(channel.customs, [["hi", 1]]);
    });

    test("custom messages reach a handler added before or after start", () => {
        const api = new DisplayApi();
        const channel = fakeChannel();
        const heard = [];
        api.on(DisplayApiEvents.custom, (type, data) => heard.push(["early", type, data]));
        api.start(channel, fakeOverlay());
        const late = (type, data) => heard.push(["late", type, data]);
        api.on(DisplayApiEvents.custom, late);
        channel.emit(DisplayChannelEvents.custom, "ping", 1);
        assert.deepEqual(heard, [
            ["early", "ping", 1],
            ["late", "ping", 1]
        ]);
        api.off(DisplayApiEvents.custom, late);
        channel.emit(DisplayChannelEvents.custom, "ping", 2);
        assert.equal(heard.length, 3);
    });

    test("an unknown event and a pairing with no render are refused", () => {
        const api = new DisplayApi();
        assert.throws(() => api.on("nothing", render), {name: "TypeError", message: /nothing/});
        assert.throws(() => api.registerPairing(/** @type {any} */ ({})), {
            name: "TypeError",
            message: /render/
        });
    });

    test("a second pairing replaces the first", () => {
        const api = new DisplayApi();
        const overlay = fakeOverlay();
        api.registerPairing({render});
        const second = {render() {}};
        api.registerPairing(second);
        api.start(fakeChannel(), overlay);
        assert.equal(overlay.pairing, second);
        const third = {render() {}};
        api.registerPairing(third);
        assert.equal(overlay.pairing, third);
    });

    test("dispose removes every listener it added", () => {
        const api = new DisplayApi();
        const channel = fakeChannel();
        api.on(DisplayApiEvents.custom, () => assert.fail("heard after dispose"));
        api.start(channel, fakeOverlay());
        api.dispose();
        assert.equal(channel.listenerCount(DisplayChannelEvents.custom), 0);
    });
});
