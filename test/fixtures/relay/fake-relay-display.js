/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A display add-on: the display's end of the stand-in relay of the shell scenarios, over a
// BroadcastChannel named after the session. test/fixtures/shell/fake-relay.js is the other end.

(() => {
    const session = new URLSearchParams(location.search).get("session");
    // A preview loads this deck too, with no session: only the deck page is the display.
    if (!session) {
        return;
    }

    const channel = new BroadcastChannel(`fake-relay:${session}`);
    const handlers = new Set();
    channel.onmessage = ({data}) => {
        if (data.to === "display") {
            handlers.forEach(handler => handler(data.message));
        }
    };

    /** @type {any} */ (window).sozi.display.registerTransport({
        status: "connected",
        send(message) {
            channel.postMessage({to: "surface", message});
            return true;
        },
        onMessage(handler) {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
        on() {},
        off() {},
        dispose() {
            channel.close();
            handlers.clear();
        }
    });
})();
