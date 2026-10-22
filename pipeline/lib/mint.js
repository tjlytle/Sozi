/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A local endpoint speaking the gh-bot-mint protocol that `gh-as` uses inside a
// container, so containers get short-lived tokens and never hold an app key.

import {execFile} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const BOTS = ["advocate", "architect", "builder", "qa", "reviewer", "ops"];
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_BODY = 4096;
const VALID_FOR_MS = 50 * 60 * 1000;

/**
 * @typedef {object} MintOptions
 * @property {number} port - The port to listen on; 0 lets the OS pick.
 * @property {string} host - The single address to bind, such as the Docker bridge.
 * @property {string} key - The bearer credential containers present.
 * @property {string[]} repos - The `owner/name` repositories tokens may be minted for.
 * @property {(bot: string, repo: string) => Promise<string>} [mint] - Produces a token; defaults to `bot-token`.
 * @property {number} [mintTimeoutMs] - How long `mint` may take before the request gets a 502; defaults to 30000.
 * @property {(entry: {bot: string, repo: string, status: number, reason?: string}) => void} [log] - Called once per request.
 */

/**
 * @typedef {object} MintServer
 * @property {string} url - The address to POST to, with the real port.
 * @property {number} port - The port actually bound.
 * @property {() => Promise<void>} close - Stops the server; resolves once it has closed.
 */

/**
 * Mint a token by running `bot-token <bot> <repo>` from the gh-personas plugin.
 * A failure rejects with the stderr only, because stdout is the token.
 *
 * @param {string} bot - The persona or bot name.
 * @param {string} repo - The `owner/name` repository.
 * @returns {Promise<string>} The token.
 */
export function defaultMint(bot, repo) {
    const cache = path.join(os.homedir(), ".claude/plugins/cache/dev-flow/gh-personas");
    let dirs = [];
    try {
        dirs = fs
            .readdirSync(cache)
            .map(v => path.join(cache, v, "bin"))
            .filter(d => fs.existsSync(d));
    } catch {
        // No plugin cache; rely on the ambient PATH.
    }
    const env = {...process.env, PATH: [...dirs, process.env.PATH ?? ""].join(path.delimiter)};
    return new Promise((resolve, reject) => {
        execFile("bot-token", [bot, repo], {env, timeout: 30000}, (err, stdout, stderr) => {
            if (err) {
                reject(
                    new Error(`bot-token failed: ${String(stderr).trim() || "no error output"}`)
                );
            } else {
                resolve(String(stdout).trim());
            }
        });
    });
}

/**
 * Compare a presented bearer header with the key in constant time.
 *
 * @param {string|undefined} header - The Authorization header.
 * @param {string} key - The expected key.
 * @returns {boolean} Whether they match.
 */
function authorised(header, key) {
    if (!header?.startsWith("Bearer ")) {
        return false;
    }
    const given = Buffer.from(header.slice(7));
    const wanted = Buffer.from(key);
    return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

/**
 * Start the mint endpoint on one address.
 *
 * @param {MintOptions} options - Where to listen, the credential, the allowed repositories and hooks.
 * @returns {Promise<MintServer>} The running server.
 */
export function startMint({
    port,
    host,
    key,
    repos,
    mint = defaultMint,
    log = () => {},
    mintTimeoutMs = 30000
}) {
    const server = http.createServer((req, res) => {
        /** @type {{bot: string, repo: string}} */
        const seen = {bot: "", repo: ""};
        /**
         * @param {number} status - The HTTP status.
         * @param {object} body - The JSON reply.
         * @param {string} [reason] - A fixed code for the log, never an error message.
         */
        const reply = (status, body, reason) => {
            res.writeHead(status, {"Content-Type": "application/json", Connection: "close"});
            res.end(JSON.stringify(body));
            try {
                log(reason ? {...seen, status, reason} : {...seen, status});
            } catch {
                // The endpoint never dies for its logger.
            }
        };

        if (!authorised(req.headers.authorization, key)) {
            req.resume();
            reply(401, {error: "unknown credential"}, "bad-credential");
            return;
        }
        if (req.method !== "POST") {
            req.resume();
            reply(400, {error: "POST only"}, "bad-method");
            return;
        }
        const chunks = [];
        let size = 0;
        let tooBig = false;
        req.on("data", chunk => {
            size += chunk.length;
            if (size > MAX_BODY) {
                if (!tooBig) {
                    tooBig = true;
                    reply(413, {error: "request too large"}, "too-large");
                }
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", async () => {
            if (tooBig) {
                return;
            }
            let parsed;
            try {
                parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
                reply(400, {error: "body is not JSON"}, "bad-body");
                return;
            }
            const {repo, bot} = parsed ?? {};
            seen.bot = typeof bot === "string" ? bot : "";
            seen.repo = typeof repo === "string" ? repo : "";
            if (typeof repo !== "string" || typeof bot !== "string") {
                reply(400, {error: "repo and bot must be strings"}, "bad-body");
                return;
            }
            if (!REPO_PATTERN.test(repo)) {
                reply(400, {error: "repo must be owner/name"}, "bad-repo");
                return;
            }
            if (!BOTS.includes(bot)) {
                reply(400, {error: "unknown bot"}, "bad-bot");
                return;
            }
            if (!repos.includes(repo)) {
                reply(403, {error: "repository not allowed"}, "repo-not-allowed");
                return;
            }
            /** @type {unknown} */
            let token;
            let timer;
            try {
                token = await Promise.race([
                    mint(bot, repo),
                    new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error("timeout")), mintTimeoutMs);
                    })
                ]);
            } catch (err) {
                reply(
                    502,
                    {error: "mint failed"},
                    err instanceof Error && err.message === "timeout" ? "timeout" : "mint-error"
                );
                return;
            } finally {
                clearTimeout(timer);
            }
            if (typeof token !== "string" || token.trim() === "") {
                reply(502, {error: "mint failed"}, "empty-token");
                return;
            }
            reply(200, {
                token: token.trim(),
                expires_at: new Date(Date.now() + VALID_FOR_MS).toISOString()
            });
        });
    });
    server.headersTimeout = 10000;
    server.requestTimeout = 30000;

    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
            server.off("error", reject);
            const bound = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
            resolve({
                url: `http://${host}:${bound}/`,
                port: bound,
                close: () =>
                    new Promise(done => {
                        server.close(() => done());
                        server.closeAllConnections();
                    })
            });
        });
    });
}
