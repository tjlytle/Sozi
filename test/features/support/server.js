/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A static file server, for the scenarios that open a deck over http rather than file:.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

/** The content type of each file a built deck serves, by extension. */
const CONTENT_TYPES = Object.freeze({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json"
});

/** Serve a directory on a free port of this machine.
 *
 * @param {string} dir - The directory to serve.
 * @returns {Promise<{url: string, close: () => Promise<void>}>} - The server's address, with
 *     no trailing slash, and a function that stops it.
 */
export async function serveDirectory(dir) {
    const server = http.createServer((request, response) => {
        const {pathname} = new URL(request.url ?? "/", "http://localhost");
        // Normalising an absolute path drops every "..", so the file stays under dir. A
        // directory's address serves its index.html, as a static host does.
        const relative = path.normalize(decodeURIComponent(pathname));
        const file = path.join(dir, relative.endsWith("/") ? `${relative}index.html` : relative);
        fs.readFile(file, (error, content) => {
            if (error) {
                response.writeHead(404).end();
                return;
            }
            const type = CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream";
            response.writeHead(200, {"Content-Type": type}).end(content);
        });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)));
    // Cast: a server listening on a port has an address object.
    const {port} = /** @type {import("node:net").AddressInfo} */ (server.address());
    return {
        url: `http://127.0.0.1:${port}`,
        close: () =>
            new Promise(resolve => {
                server.close(() => resolve());
                server.closeAllConnections();
            })
    };
}
