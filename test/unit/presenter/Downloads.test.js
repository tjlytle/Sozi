import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {Downloads} from "../../../src/js/presenter/Downloads.js";

/** Downloads on a fake page and window, with what they did.
 *
 * @returns {any} - The downloads, the anchors, the blobs, the revoked URLs and the timers.
 */
function fakeDownloads() {
    const anchors = [];
    const doc = /** @type {any} */ ({
        createElement: name => {
            assert.equal(name, "a");
            const anchor = {
                href: "",
                download: "",
                clicks: 0,
                click() {
                    this.clicks++;
                }
            };
            anchors.push(anchor);
            return anchor;
        }
    });
    const timers = new Map();
    const created = [];
    const revoked = [];
    let nextTimer = 1;
    const host = {
        Blob: class {
            /** Keep what the blob holds.
             *
             * @param {string[]} parts - Its text.
             * @param {object} options - Its type.
             */
            constructor(parts, options) {
                this.parts = parts;
                this.options = options;
            }
        },
        URL: {
            createObjectURL: blob => {
                created.push(blob);
                return `blob:${created.length}`;
            },
            revokeObjectURL: url => revoked.push(url)
        },
        setTimeout: (fn, ms) => {
            const id = nextTimer++;
            timers.set(id, {fn, ms});
            return id;
        },
        clearTimeout: id => timers.delete(id)
    };
    return {downloads: new Downloads(doc, host), anchors, created, revoked, timers};
}

describe("Downloads", () => {
    test("downloads a text under a name, with its type", () => {
        const {downloads, anchors, created} = fakeDownloads();
        downloads.download("basic-drawings.svg", "<svg/>", "image/svg+xml");
        assert.equal(anchors.length, 1);
        assert.equal(anchors[0].download, "basic-drawings.svg");
        assert.equal(anchors[0].href, "blob:1");
        assert.equal(anchors[0].clicks, 1);
        assert.deepEqual(created[0].parts, ["<svg/>"]);
        assert.deepEqual(created[0].options, {type: "image/svg+xml"});
    });

    test("the URL is revoked once the download has had time to start", () => {
        const {downloads, revoked, timers} = fakeDownloads();
        downloads.download("a.json", "{}", "application/json");
        assert.deepEqual(revoked, []);
        const [{fn, ms}] = timers.values();
        assert.ok(ms >= 10000, `a slow phone gets time to start: ${ms}`);
        fn();
        assert.deepEqual(revoked, ["blob:1"]);
        assert.equal(timers.size, 0);
    });

    test("dispose revokes every URL still waiting, and clears its timer", () => {
        const {downloads, revoked, timers} = fakeDownloads();
        downloads.download("a.json", "{}", "application/json");
        downloads.download("b.svg", "<svg/>", "image/svg+xml");
        [...timers.values()][0].fn();
        downloads.dispose();
        assert.deepEqual(revoked, ["blob:1", "blob:2"]);
        assert.equal(timers.size, 0);
    });
});
