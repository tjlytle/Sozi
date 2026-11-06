import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {ThumbnailSource} from "../../../src/js/presenter/ThumbnailSource.js";
import {Roles, helloMessage, previewMessage} from "../../../src/js/protocol/messages.js";
import {thumbnailMessage, thumbnailRequestMessage} from "../../../src/js/protocol/thumbnails.js";

const JPEG = "data:image/jpeg;base64,AAAA";
const DECK = {deckId: "basic", version: "v1", frameCount: 3, aspect: 2};

/** Stand-in for the page: the iframes it was given, each of which can be told it has loaded.
 *
 * @returns {any} - The fake document; `iframes` lists every iframe made, removed or not.
 */
function fakeDocument() {
    const iframes = [];
    return {
        iframes,
        body: {
            append(iframe) {
                iframe.attached = true;
            }
        },
        createElement(name) {
            assert.equal(name, "iframe");
            const listeners = new Set();
            const iframe = {
                attached: false,
                style: {},
                contentWindow: {},
                listeners,
                setAttribute() {},
                addEventListener(type, listener) {
                    assert.equal(type, "load");
                    listeners.add(listener);
                },
                removeEventListener(type, listener) {
                    listeners.delete(listener);
                },
                remove() {
                    this.attached = false;
                },
                load() {
                    for (const listener of [...listeners]) {
                        listener();
                    }
                }
            };
            iframes.push(iframe);
            return iframe;
        }
    };
}

/** Stand-in for a transport to the deck: it records what is sent and delivers what a test posts.
 *
 * @returns {any} - The fake transport.
 */
function fakeTransport() {
    return {
        sent: [],
        handlers: new Set(),
        disposed: false,
        send(message) {
            this.sent.push(message);
            return true;
        },
        onMessage(handler) {
            this.handlers.add(handler);
            return () => this.handlers.delete(handler);
        },
        dispose() {
            this.disposed = true;
            this.handlers.clear();
        },
        deliver(data) {
            for (const handler of [...this.handlers]) {
                handler(data);
            }
        }
    };
}

/** Stand-in for the cache: what it already holds, and what it was given.
 *
 * @param {[number, string][]} [held] - The thumbnails it holds, by index.
 * @returns {any} - The fake cache.
 */
function fakeCache(held = []) {
    return {
        opened: [],
        puts: [],
        disposed: false,
        async open(deckId, version) {
            this.opened.push([deckId, version]);
            return new Map(held);
        },
        async put(index, url) {
            this.puts.push([index, url]);
        },
        dispose() {
            this.disposed = true;
        }
    };
}

/** A source on fakes, with everything it reports collected.
 *
 * @param {[number, string][]} [held] - The thumbnails the cache holds, by index.
 * @returns {any} - The source and its fakes.
 */
function fakeSource(held) {
    const doc = fakeDocument();
    const cache = fakeCache(held);
    const transports = [];
    const source = new ThumbnailSource({
        cache,
        doc,
        src: "basic.sozi.html",
        pageVersion: "page1",
        width: 320,
        createTransport: () => {
            const transport = fakeTransport();
            transports.push(transport);
            return transport;
        }
    });
    const reported = [];
    return {source, doc, cache, transports, reported, onThumbnail: (i, u) => reported.push([i, u])};
}

/** A source whose deck has loaded and said hello, and whose first request has gone out.
 *
 * @param {[number, string][]} [held] - The thumbnails the cache holds, by index.
 * @returns {Promise<any>} - The source and its fakes, with `transport` the deck's.
 */
async function sourceWithDeck(held) {
    const fakes = fakeSource(held);
    await fakes.source.show(DECK, fakes.onThumbnail);
    fakes.doc.iframes[0].load();
    const [transport] = fakes.transports;
    transport.deliver(helloMessage(Roles.display, {...displayState()}));
    return {...fakes, transport};
}

/** A deck's state, for its hello.
 *
 * @returns {any} - The state.
 */
function displayState() {
    const frame = {index: 0, id: "f", title: "One", notes: ""};
    return {deckId: "basic", frameCount: 3, viewport: null, frame, frames: [frame], blank: false};
}

/** The thumbnail requests a transport carried.
 *
 * @param {any} transport - The fake transport.
 * @returns {any[]} - The requests.
 */
function requests(transport) {
    return transport.sent.filter(message => message.name === "thumbnailRequest");
}

describe("ThumbnailSource", () => {
    test("a deck wholly in the cache makes no iframe, and its thumbnails are reported", async () => {
        const held = [0, 1, 2].map(i => [i, JPEG]);
        const {source, doc, reported, onThumbnail} = fakeSource(/** @type {any} */ (held));
        await source.show(DECK, onThumbnail);
        assert.equal(doc.iframes.length, 0);
        assert.deepEqual(reported, held);
    });

    test("the cache is keyed by the deck, its date and the page's date", async () => {
        const {source, cache, onThumbnail} = fakeSource();
        await source.show(DECK, onThumbnail);
        assert.deepEqual(cache.opened, [["basic", "v1 page1"]]);
    });

    test("something missing makes one off-screen iframe with the display's shape", async () => {
        const {source, doc, onThumbnail} = fakeSource([[0, JPEG]]);
        await source.show(DECK, onThumbnail);
        assert.equal(doc.iframes.length, 1);
        const [iframe] = doc.iframes;
        assert.equal(iframe.attached, true);
        assert.equal(iframe.src, "basic.sozi.html");
        assert.equal(iframe.className, "sozi-thumbnail-deck");
        const ratio = parseFloat(iframe.style.width) / parseFloat(iframe.style.height);
        assert.equal(ratio, 2);
    });

    test("a loaded deck is greeted, and made a preview once it says hello", async () => {
        const {source, doc, transports, onThumbnail} = fakeSource();
        await source.show(DECK, onThumbnail);
        doc.iframes[0].load();
        const [transport] = transports;
        assert.deepEqual(transport.sent, [helloMessage(Roles.surface)]);
        transport.deliver(helloMessage(Roles.display, displayState()));
        assert.deepEqual(transport.sent.slice(1), [
            previewMessage(false),
            thumbnailRequestMessage(0, 320)
        ]);
    });

    test("one request at a time: the next goes out when the last is answered", async () => {
        const {transport, reported, cache} = await sourceWithDeck();
        assert.equal(requests(transport).length, 1);
        transport.deliver(thumbnailMessage(0, JPEG));
        assert.deepEqual(requests(transport), [
            thumbnailRequestMessage(0, 320),
            thumbnailRequestMessage(1, 320)
        ]);
        assert.deepEqual(reported, [[0, JPEG]]);
        assert.deepEqual(cache.puts, [[0, JPEG]]);
    });

    test("a second hello from the deck does not send a second request", async () => {
        const {transport} = await sourceWithDeck();
        transport.deliver(helloMessage(Roles.display, displayState()));
        assert.equal(requests(transport).length, 1);
    });

    test("a visible frame is rendered before the others", async () => {
        const {source, transport} = await sourceWithDeck();
        source.setVisible([2]);
        transport.deliver(thumbnailMessage(0, JPEG));
        assert.deepEqual(requests(transport).at(-1), thumbnailRequestMessage(2, 320));
    });

    test("a failed render reports nothing, is not cached, and moves on", async () => {
        const {transport, reported, cache} = await sourceWithDeck();
        transport.deliver(thumbnailMessage(0, ""));
        assert.deepEqual(reported, []);
        assert.deepEqual(cache.puts, []);
        assert.deepEqual(requests(transport).at(-1), thumbnailRequestMessage(1, 320));
    });

    test("the iframe goes when nothing is left", async () => {
        const {doc, transport} = await sourceWithDeck();
        for (const index of [0, 1, 2]) {
            transport.deliver(thumbnailMessage(index, JPEG));
        }
        assert.equal(doc.iframes[0].attached, false);
        assert.equal(doc.iframes[0].listeners.size, 0);
        assert.equal(transport.disposed, true);
    });

    test("an answer for a frame that was not asked for is ignored", async () => {
        const {transport, reported} = await sourceWithDeck();
        transport.deliver(thumbnailMessage(2, JPEG));
        assert.deepEqual(reported, []);
        assert.equal(requests(transport).length, 1);
    });

    test("showing a new version closes the old deck and starts again", async () => {
        const {source, doc, transport, reported, onThumbnail} = await sourceWithDeck();
        await source.show({...DECK, version: "v2"}, onThumbnail);
        assert.equal(transport.disposed, true);
        assert.equal(doc.iframes[0].attached, false);
        assert.equal(doc.iframes.length, 2);
        assert.deepEqual(reported, []);
    });

    test("dispose leaves nothing behind", async () => {
        const {source, doc, cache, transport, reported} = await sourceWithDeck();
        source.dispose();
        assert.equal(doc.iframes[0].attached, false);
        assert.equal(doc.iframes[0].listeners.size, 0);
        assert.equal(transport.disposed, true);
        assert.equal(transport.handlers.size, 0);
        assert.equal(cache.disposed, true);
        assert.deepEqual(reported, []);
    });

    test("disposed while the cache is opening, it makes no iframe", async () => {
        const {source, doc, onThumbnail} = fakeSource();
        const shown = source.show(DECK, onThumbnail);
        source.dispose();
        await shown;
        assert.equal(doc.iframes.length, 0);
    });
});
