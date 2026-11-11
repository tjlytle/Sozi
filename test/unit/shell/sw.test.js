import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import nunjucks from "nunjucks";

const TEMPLATE = path.resolve(import.meta.dirname, "../../../src/templates/sw.js");
const SCOPE = "https://host.example/talks/shell/";
const FILES = ["./", "index.html", "addons.js"];

/** Stand-in for one cache: it stores the address of each file it was asked to add.
 *
 * @returns {any} - The fake cache.
 */
function fakeCache() {
    const responses = new Map();
    return {
        responses,
        async addAll(files) {
            for (const file of files) {
                const {href} = new URL(file, SCOPE);
                responses.set(href, `cached ${href}`);
            }
        },
        async match({url}) {
            return responses.get(url);
        }
    };
}

/** Stand-in for the browser's cache storage.
 *
 * @returns {any} - The fake storage.
 */
function fakeCaches() {
    const stores = new Map();
    return {
        stores,
        async open(name) {
            if (!stores.has(name)) {
                stores.set(name, fakeCache());
            }
            return stores.get(name);
        },
        async keys() {
            return [...stores.keys()];
        },
        async delete(name) {
            return stores.delete(name);
        }
    };
}

/** Run the rendered worker in a fake service worker scope.
 *
 * @param {string} version - The Sozi version it is built with.
 * @param {any} caches - The cache storage it sees.
 * @param {string} scope - The scope it is registered with.
 * @returns {any} - Its parts: what it sends to the network, and a way to fire its events.
 */
function worker(version, caches, scope = SCOPE) {
    const listeners = new Map();
    const network = [];
    const source = fs.readFileSync(TEMPLATE, "utf8");
    const self = {
        registration: {scope},
        addEventListener(name, listener) {
            listeners.set(name, listener);
        }
    };
    const fetch = async request => {
        network.push(request.url);
        return `network ${request.url}`;
    };
    vm.runInNewContext(nunjucks.renderString(source, {version, files: FILES}), {
        self,
        caches,
        fetch
    });
    return {
        network,
        /** Fire an install or activate event, and wait for what it waits on.
         *
         * @param {string} name - The event.
         * @returns {Promise<void>} - Resolves when the work is done.
         */
        async lifecycle(name) {
            let work;
            listeners.get(name)({
                waitUntil(promise) {
                    work = promise;
                }
            });
            await work;
        },
        /** Fire a fetch event, and say what the worker answers.
         *
         * @param {string} url - The address asked for.
         * @returns {Promise<any>} - The answer.
         */
        async fetched(url) {
            let answer;
            listeners.get("fetch")({
                request: {url},
                respondWith(promise) {
                    answer = promise;
                }
            });
            return answer;
        }
    };
}

describe("the shell's service worker", () => {
    test("is plain JavaScript before it is rendered, so that the build's tools can read it", () => {
        assert.doesNotThrow(() => new vm.Script(fs.readFileSync(TEMPLATE, "utf8")));
    });

    test("install precaches the shell's files in a cache named after the version", async () => {
        const caches = fakeCaches();
        await worker("1.2.3", caches).lifecycle("install");
        assert.equal(caches.stores.size, 1);
        const [[name, cache]] = [...caches.stores];
        assert.match(name, /1\.2\.3/);
        assert.deepEqual(
            [...cache.responses.keys()],
            FILES.map(file => new URL(file, SCOPE).href)
        );
    });

    test("a shell file comes from the cache, with no network", async () => {
        const caches = fakeCaches();
        const sw = worker("1.2.3", caches);
        await sw.lifecycle("install");
        const url = `${SCOPE}addons.js`;
        assert.equal(await sw.fetched(url), `cached ${url}`);
        assert.deepEqual(sw.network, []);
    });

    test("any other request goes to the network and is not cached", async () => {
        const caches = fakeCaches();
        const sw = worker("1.2.3", caches);
        await sw.lifecycle("install");
        const url = "https://relay.example/session";
        assert.equal(await sw.fetched(url), `network ${url}`);
        assert.deepEqual(sw.network, [url]);
        assert.equal((await caches.open([...caches.stores.keys()][0])).responses.has(url), false);
    });

    test("activate drops the caches of other versions and keeps its own", async () => {
        const caches = fakeCaches();
        await worker("1.2.3", caches).lifecycle("install");
        const next = worker("1.2.4", caches);
        await next.lifecycle("install");
        assert.equal(caches.stores.size, 2);
        await next.lifecycle("activate");
        const names = [...caches.stores.keys()];
        assert.equal(names.length, 1);
        assert.match(names[0], /1\.2\.4/);
    });

    test("the cache name holds the scope as well as the version", async () => {
        const caches = fakeCaches();
        await worker("1.2.3", caches).lifecycle("install");
        const [name] = [...caches.stores.keys()];
        assert.ok(name.includes(SCOPE), name);
        assert.ok(name.includes("1.2.3"), name);
    });

    test("activate keeps the caches of another installation on the same origin", async () => {
        const caches = fakeCaches();
        await worker("1.2.3", caches, "https://host.example/a/").lifecycle("install");
        const other = worker("1.2.4", caches, "https://host.example/b/");
        await other.lifecycle("install");
        await other.lifecycle("activate");
        assert.equal(caches.stores.size, 2);
    });

    test("activate keeps the caches of an installation whose path starts with its own", async () => {
        const caches = fakeCaches();
        await worker("1.2.3", caches, "https://host.example/a/b/").lifecycle("install");
        const outer = worker("1.2.4", caches, "https://host.example/a/");
        await outer.lifecycle("install");
        await outer.lifecycle("activate");
        const names = [...caches.stores.keys()];
        assert.equal(names.length, 2);
        assert.ok(
            names.some(name => name.includes("https://host.example/a/b/")),
            names.join()
        );
    });
});
