import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {ThumbnailCache} from "../../../src/js/presenter/ThumbnailCache.js";

const JPEG = "data:image/jpeg;base64,AAAA";

/** Stand-in for an IndexedDB whose database cannot be opened.
 *
 * @returns {any} - The fake.
 */
function refusingIndexedDB() {
    return {
        open() {
            const request = {error: new Error("refused")};
            queueMicrotask(() => /** @type {any} */ (request).onerror());
            return request;
        }
    };
}

describe("ThumbnailCache", () => {
    for (const [name, indexedDB] of [
        ["there is no IndexedDB", undefined],
        ["IndexedDB throws", {open: () => assert.fail("no database here")}],
        ["IndexedDB refuses", refusingIndexedDB()]
    ]) {
        test(`when ${name}, thumbnails last in memory`, async () => {
            const cache = new ThumbnailCache(indexedDB);
            assert.deepEqual(await cache.open("basic", "v1"), new Map());
            await cache.put(1, JPEG);
            assert.deepEqual(await cache.open("basic", "v1"), new Map([[1, JPEG]]));
        });
    }

    test("another version of the deck starts empty in memory too", async () => {
        const cache = new ThumbnailCache(undefined);
        await cache.open("basic", "v1");
        await cache.put(1, JPEG);
        assert.deepEqual(await cache.open("basic", "v2"), new Map());
        assert.deepEqual(await cache.open("basic", "v1"), new Map());
    });

    test("dispose can be called with no database open", () => {
        new ThumbnailCache(undefined).dispose();
    });
});
