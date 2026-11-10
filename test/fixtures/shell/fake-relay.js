/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The shell's addons.js in the scenarios: the surface's end of the stand-in relay, over a
// BroadcastChannel named after the session. test/fixtures/relay/fake-relay-display.js is the
// other end. Like a real relay, it is connected only once it has heard from the display.

// The page's own load listener comes first, so the pairing link has been read by now.
window.addEventListener("load", () => {
    const {presenter} = /** @type {any} */ (window).sozi;
    if (!presenter.link) {
        return;
    }

    const channel = new BroadcastChannel(`fake-relay:${presenter.link.session}`);
    const handlers = new Set();
    const statusListeners = new Set();
    const transport = {
        status: "reconnecting",
        send(message) {
            channel.postMessage({to: "display", message});
            return true;
        },
        onMessage(handler) {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
        on(event, listener) {
            statusListeners.add(listener);
        },
        off(event, listener) {
            statusListeners.delete(listener);
        },
        dispose() {
            channel.close();
            handlers.clear();
            statusListeners.clear();
        }
    };
    channel.onmessage = ({data}) => {
        if (data.to !== "surface") {
            return;
        }
        if (transport.status !== "connected") {
            transport.status = "connected";
            statusListeners.forEach(listener => listener(transport.status));
        }
        handlers.forEach(handler => handler(data.message));
    };
    presenter.registerTransport(transport);
});
