import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {statusText} from "../../../src/js/presenter/statusText.js";
import {TransportStatus} from "../../../src/js/protocol/LocalTransport.js";

describe("statusText", () => {
    test("names each status of a transport", () => {
        assert.equal(statusText(TransportStatus.connected), "Connected");
        assert.equal(statusText(TransportStatus.reconnecting), "Reconnecting");
        assert.equal(statusText(TransportStatus.stale), "Stale");
        assert.equal(statusText(TransportStatus.closed), "Closed");
    });

    test("gives back a status it does not know", () => {
        assert.equal(statusText("lost"), "lost");
        assert.equal(statusText("toString"), "toString");
    });
});
