import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {DisplayMirror} from "../../../src/js/presenter/DisplayMirror.js";
import {PresenterApi, PresenterEvents} from "../../../src/js/presenter/PresenterApi.js";
import {ShellJoin} from "../../../src/js/presenter/ShellJoin.js";
import {TransportStatus} from "../../../src/js/protocol/LocalTransport.js";
import {TransportSet} from "../../../src/js/protocol/TransportSet.js";

const DECK = "https://talks.example/deck.sozi.html";
const LINK = `#deck=${encodeURIComponent(DECK)}&session=s1`;

/** Stand-in for the page: the two elements the shell uses.
 *
 * @returns {any} - The fake document.
 */
function fakeDocument() {
    const elements = {
        ".sozi-workspace": {dataset: {deck: ""}},
        ".sozi-connection-notice": {hidden: true, textContent: ""}
    };
    return {elements, querySelector: selector => elements[selector]};
}

/** Stand-in for the window: it records listeners, reloads, workers and popups.
 *
 * @param {string} hash - The fragment of its address.
 * @param {object} [options] - What differs from a browser online.
 * @param {boolean} [options.onLine] - Is the browser online?
 * @param {any} [options.serviceWorker] - The browser's service worker container.
 * @returns {any} - The fake window.
 */
function fakeWindow(hash, {onLine = true, serviceWorker} = {}) {
    const fake = /** @type {any} */ ({
        listeners: new Map(),
        registered: [],
        reloads: 0,
        popups: 0,
        reported: [],
        location: {
            hash,
            reload() {
                fake.reloads++;
            }
        },
        navigator: {
            onLine,
            serviceWorker: serviceWorker ?? {
                register(url) {
                    fake.registered.push(url);
                    return Promise.resolve();
                }
            }
        },
        addEventListener(name, listener) {
            fake.listeners.set(name, listener);
        },
        removeEventListener(name, listener) {
            if (fake.listeners.get(name) === listener) {
                fake.listeners.delete(name);
            }
        },
        fire(name) {
            fake.listeners.get(name)();
        },
        open() {
            fake.popups++;
        },
        reportError(error) {
            fake.reported.push(error);
        }
    });
    return fake;
}

/** A started shell on a real API, with a fake page.
 *
 * @param {string} hash - The fragment of the page's address.
 * @param {object} [options] - What `fakeWindow` takes.
 * @returns {any} - The shell and its parts.
 */
function startedShell(hash, options) {
    const mirror = new DisplayMirror();
    const api = new PresenterApi({mirror, transports: new TransportSet()});
    const document = fakeDocument();
    const window = fakeWindow(hash, options);
    const join = new ShellJoin({api, document, window});
    join.start();
    return {
        join,
        api,
        mirror,
        window,
        workspace: document.elements[".sozi-workspace"],
        notice: document.elements[".sozi-connection-notice"]
    };
}

describe("ShellJoin", () => {
    test("a pairing link points the previews at the deck and publishes the link", () => {
        const {api, workspace} = startedShell(LINK);
        assert.equal(workspace.dataset.deck, DECK);
        assert.equal(api.link.deck, DECK);
        assert.equal(api.link.session, "s1");
    });

    test("opens no audience window", () => {
        assert.equal(startedShell(LINK).window.popups, 0);
    });

    test("says it is not connected until the transport says otherwise", () => {
        const {notice, mirror} = startedShell(LINK);
        assert.equal(notice.hidden, false);
        assert.equal(notice.textContent, "Not connected");

        mirror.setStatus(TransportStatus.connected);
        assert.equal(notice.hidden, true);

        mirror.setStatus("reconnecting");
        assert.equal(notice.hidden, false);
        assert.equal(notice.textContent, "Not connected");
    });

    test("with no link it says how to join and no preview gets a deck", () => {
        const {api, notice, workspace} = startedShell("");
        assert.equal(api.link, null);
        assert.equal(workspace.dataset.deck, "");
        assert.equal(notice.hidden, false);
        assert.match(notice.textContent, /^Not connected/);
        assert.match(notice.textContent, /Open a pairing link to join a talk\./);
    });

    test("refuses a link whose deck is not a web address", () => {
        const hash = `#deck=${encodeURIComponent("javascript:alert(1)")}&session=s1`;
        const {api, notice, workspace} = startedShell(hash);
        assert.equal(api.link, null);
        assert.equal(workspace.dataset.deck, "");
        assert.equal(notice.hidden, false);
        assert.equal(notice.textContent, "This is not a Sozi pairing link.");
    });

    test("registers the service worker by a relative address", () => {
        assert.deepEqual(startedShell(LINK).window.registered, ["sw.js"]);
    });

    test("a browser that refuses the worker is reported, and the shell goes on", async () => {
        const failure = new Error("refused");
        const serviceWorker = {register: () => Promise.reject(failure)};
        const {window, workspace} = startedShell(LINK, {serviceWorker});
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(window.reported, [failure]);
        assert.equal(workspace.dataset.deck, DECK);
    });

    test("reloads when the link changes", () => {
        const {window} = startedShell(LINK);
        assert.equal(window.reloads, 0);
        window.fire("hashchange");
        assert.equal(window.reloads, 1);
    });

    test("offline, the previews stay empty until the browser is back online", () => {
        const {api, window, workspace} = startedShell(LINK, {onLine: false});
        assert.equal(workspace.dataset.deck, "");
        // The link is still the link: the add-on can say what it is waiting for.
        assert.equal(api.link.session, "s1");
        window.fire("online");
        assert.equal(window.reloads, 1);
    });

    test("a shell that opened online does not reload when the network comes back", () => {
        const {window} = startedShell(LINK);
        assert.equal(window.listeners.has("online"), false);
    });

    test("dispose removes every listener", () => {
        const {join, api, mirror, notice, window} = startedShell(LINK, {onLine: false});
        join.dispose();
        assert.equal(window.listeners.size, 0);
        assert.equal(api.events.listenerCount(PresenterEvents.status), 0);
        mirror.setStatus(TransportStatus.connected);
        assert.equal(notice.hidden, false);
    });
});
