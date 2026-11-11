import {test} from "node:test";
import assert from "node:assert/strict";
import {PublishedNotes} from "../../../src/js/presenter/PublishedNotes.js";

const frames = [{id: "one", index: 0, title: "One", notes: "Deck"}];

test("a file deck never fetches and keeps the original frames", async () => {
    const notes = new PublishedNotes({
        fetch: () => assert.fail("must not fetch"),
        deckHref: () => "file:///deck.sozi.html",
        onLoad: () => assert.fail("must not notify")
    });
    await notes.load();
    assert.equal(notes.overlay(frames), frames);
});

test("load reads the address lazily and fetches once, overlaying the published notes", async () => {
    let calls = 0;
    let loaded = 0;
    let href = "file:///deck.sozi.html";
    const notes = new PublishedNotes({
        fetch: async url => {
            calls++;
            assert.equal(url, "https://example.org/deck.notes.md");
            return {ok: true, text: async () => "# One\n\nPublished"};
        },
        deckHref: () => href,
        onLoad: () => loaded++
    });
    href = "https://example.org/deck.sozi.html";
    await Promise.all([notes.load(), notes.load()]);
    assert.equal(calls, 1);
    assert.equal(loaded, 1);
    assert.match(notes.overlay(frames)[0].notes, /Published/);
    assert.equal(frames[0].notes, "Deck");
});

for (const failure of ["404", "rejected", "body rejected"]) {
    test(`${failure} keeps the original frames without notifying`, async () => {
        const notes = new PublishedNotes({
            fetch: async () => {
                if (failure === "rejected") {
                    throw new TypeError("CORS");
                }
                return {
                    ok: failure !== "404",
                    text: async () => {
                        throw new TypeError("body unavailable");
                    }
                };
            },
            deckHref: () => "https://example.org/deck.sozi.html",
            onLoad: () => assert.fail("must not notify")
        });
        await notes.load();
        assert.equal(notes.overlay(frames), frames);
    });
}

test("dispose ignores a response still in flight", async () => {
    /** @type {(value: Pick<Response, "ok" | "text">) => void} */
    let respond = () => assert.fail("response resolver was not installed");
    /** @type {Promise<Pick<Response, "ok" | "text">>} */
    const response = new Promise(resolve => {
        respond = resolve;
    });
    const notes = new PublishedNotes({
        fetch: () => response,
        deckHref: () => "https://example.org/deck.sozi.html",
        onLoad: () => assert.fail("must not notify after disposal")
    });
    const pending = notes.load();
    notes.dispose();
    respond({ok: true, text: async () => "# One\n\nLate"});
    await pending;
    assert.equal(notes.overlay(frames), frames);
});
