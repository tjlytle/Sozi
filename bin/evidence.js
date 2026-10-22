#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Evidence hosting. Uploads a file (a QA screenshot, a rendered page) to a Cloudflare
// R2 bucket through Cloudflare's REST object API and prints the public URL, so GitHub
// comments and Notion pages can show it without the file ever living on a branch.
//
//   node bin/evidence.js put <file> [--key KEY]
//
// The default key is <PIPELINE_RUN or today's UTC date>/<PIPELINE_ISSUE or "run">/<name>-<hash>.<ext>.
// Environment: PIPELINE_EVIDENCE_ACCOUNT, PIPELINE_EVIDENCE_BUCKET, PIPELINE_EVIDENCE_TOKEN
// (a Cloudflare API token with R2 write access) and PIPELINE_EVIDENCE_URL (the bucket's
// public base URL, no trailing slash). Prints the URL on stdout; on failure prints the
// message on stderr and exits 1; any other subcommand prints this usage and exits 2.

import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

const USAGE = ["usage:", "  node bin/evidence.js put <file> [--key KEY]"];

const CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".html": "text/html",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json"
};

/** The MIME type for a file, from its extension.
 *
 * @param {string} file - The file name or path.
 * @returns {string} - The content type, application/octet-stream when unknown.
 */
export function contentTypeOf(file) {
    return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** The object key for a file: run, issue, then the name with a short content hash.
 *
 * @param {string} file - The file to upload.
 * @param {object} [options] - The key parts.
 * @param {string} [options.run] - The run id; the UTC date of `now` when empty.
 * @param {string|number} [options.issue] - The issue number; "run" when empty.
 * @param {Date} [options.now] - The clock; the current time by default.
 * @returns {string} - The key.
 */
export function keyFor(file, {run, issue, now = new Date()} = {}) {
    const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 6);
    const ext = path.extname(file);
    const name = path.basename(file, ext);
    return `${run || now.toISOString().slice(0, 10)}/${issue || "run"}/${name}-${hash}${ext}`;
}

/** Percent-encode each segment of a key, keeping the slashes.
 *
 * @param {string} key - The object key.
 * @returns {string} - The key as a URL path.
 */
function encodeKey(key) {
    return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * @typedef {object} EvidenceResponse
 * @property {boolean} ok - Whether the upload succeeded.
 * @property {number} status - The HTTP status.
 * @property {() => Promise<string>} [text] - The response body.
 */

/** Upload a file to R2 and return its public URL.
 *
 * @param {object} options - The upload.
 * @param {string} options.file - The file to upload.
 * @param {string} options.key - The object key.
 * @param {Record<string, string|undefined>} [options.env] - Where the PIPELINE_EVIDENCE_* variables are read from.
 * @param {(url: string, init: object) => Promise<EvidenceResponse>} [options.fetch] - The HTTP client.
 * @param {number} [options.timeoutMs] - Abort the upload after this many milliseconds; 60000 by default.
 * @returns {Promise<string>} - The public URL.
 */
export async function put({
    file,
    key,
    env = process.env,
    fetch: doFetch = fetch,
    timeoutMs = 60000
}) {
    if (key.split("/").some(part => part === "" || part === "." || part === "..")) {
        throw new Error(`invalid key: ${JSON.stringify(key)}`);
    }
    const need = name => {
        const value = env[name];
        if (!value) {
            throw new Error(`${name} is not set`);
        }
        return value;
    };
    const account = need("PIPELINE_EVIDENCE_ACCOUNT");
    const bucket = need("PIPELINE_EVIDENCE_BUCKET");
    const token = need("PIPELINE_EVIDENCE_TOKEN");
    const base = need("PIPELINE_EVIDENCE_URL");
    const encoded = encodeKey(key);
    const response = await doFetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/${encoded}`,
        {
            method: "PUT",
            headers: {Authorization: `Bearer ${token}`, "Content-Type": contentTypeOf(file)},
            body: fs.readFileSync(file),
            signal: AbortSignal.timeout(timeoutMs)
        }
    );
    if (!response.ok) {
        const text = typeof response.text === "function" ? await response.text() : "";
        const body = text.split(token).join("***");
        throw new Error(`evidence upload failed: ${response.status} ${body.slice(0, 200)}`.trim());
    }
    return `${base.replace(/\/+$/, "")}/${encoded}`;
}

/** Run the command line.
 *
 * @param {string[]} argv - The arguments after the script name.
 * @returns {Promise<number>} - The exit status.
 */
export async function main(argv) {
    const [command, file, ...rest] = argv;
    const keyAt = rest.indexOf("--key");
    if (command !== "put" || !file || (keyAt >= 0 && !rest[keyAt + 1])) {
        console.error(USAGE.join("\n"));
        return 2;
    }
    try {
        const key =
            keyAt >= 0 && rest[keyAt + 1]
                ? rest[keyAt + 1]
                : keyFor(file, {run: process.env.PIPELINE_RUN, issue: process.env.PIPELINE_ISSUE});
        console.log(await put({file, key}));
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(await main(process.argv.slice(2)));
}
