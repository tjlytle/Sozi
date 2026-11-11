/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The hosted shell's service worker. The build renders this file. Its fields stay inside
// strings, so that it is plain JavaScript before that too: the build's tools read src/**/*.js.

// This installation's caches, named by its scope and then its version. Other installations
// on the origin have other scopes. A URL holds no space, so the space after the scope stops
// "/a/" from matching the caches of "/a/b/".
const CACHE_PREFIX = "sozi-shell " + self.registration.scope + " ";
const CACHE = CACHE_PREFIX + "{{ version }}";
const FILES = "{{ files | join(' ') }}".split(" ");

/** Keep the shell's files for this version.
 *
 * @returns {Promise<void>} - Resolves when they are all kept.
 */
async function precache() {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES);
}

/** Drop what this installation's earlier versions kept, and leave other installations' caches.
 *
 * @returns {Promise<void>} - Resolves when they are gone.
 */
async function dropOldCaches() {
    const names = await caches.keys();
    const old = names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE);
    await Promise.all(old.map(name => caches.delete(name)));
}

/** Answer a request with a kept file, or leave it to the network.
 *
 * @param {Request} request - The request.
 * @returns {Promise<Response>} - The answer.
 */
async function answer(request) {
    const cache = await caches.open(CACHE);
    return (await cache.match(request)) || fetch(request);
}

self.addEventListener("install", event => event.waitUntil(precache()));
self.addEventListener("activate", event => event.waitUntil(dropOldCaches()));
self.addEventListener("fetch", event => event.respondWith(answer(event.request)));
