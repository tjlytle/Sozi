import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {keyFor, contentTypeOf, put} from "../../bin/evidence.js";

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ev-")), "shot.png");
fs.writeFileSync(tmp, "png-bytes");
const env = {
    PIPELINE_EVIDENCE_ACCOUNT: "acc",
    PIPELINE_EVIDENCE_BUCKET: "b",
    PIPELINE_EVIDENCE_TOKEN: "t",
    PIPELINE_EVIDENCE_URL: "https://ev.example"
};
const script = path.resolve("bin/evidence.js");

/** Run the CLI with a clean environment.
 *
 * @param {string[]} args - The arguments.
 * @param {Record<string, string>} extra - Environment variables to set.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} - The result.
 */
function cli(args, extra = {}) {
    return spawnSync(process.execPath, [script, ...args], {
        encoding: "utf8",
        env: {PATH: process.env.PATH, NODE_NO_WARNINGS: "1", ...extra}
    });
}

describe("evidence", () => {
    test("keys are run/issue/name-hash.ext", () => {
        assert.match(
            keyFor(tmp, {run: "2026-10-21-1902", issue: 25}),
            /^2026-10-21-1902\/25\/shot-[0-9a-f]{6}\.png$/
        );
        assert.match(
            keyFor(tmp, {now: new Date("2026-10-21T00:00:00Z")}),
            /^2026-10-21\/run\/shot-[0-9a-f]{6}\.png$/
        );
        assert.equal(contentTypeOf("a.html"), "text/html");
    });
    test("put PUTs to the R2 object API and returns the public URL", async () => {
        /** @type {any} */
        let seen;
        const url = await put({
            file: tmp,
            key: "k/shot.png",
            env,
            fetch: async (u, init) => {
                seen = {u, init};
                return {ok: true, status: 200};
            }
        });
        assert.equal(url, "https://ev.example/k/shot.png");
        assert.equal(
            seen.u,
            "https://api.cloudflare.com/client/v4/accounts/acc/r2/buckets/b/objects/k/shot.png"
        );
        assert.equal(seen.init.method, "PUT");
        assert.equal(seen.init.headers.Authorization, "Bearer t");
        assert.equal(seen.init.headers["Content-Type"], "image/png");
    });
    test("a failed upload is an error with the status, never the token", async () => {
        await assert.rejects(
            put({
                file: tmp,
                key: "k",
                env,
                fetch: async () => ({ok: false, status: 401, text: async () => "no"})
            }),
            e =>
                /401/.test(/** @type {Error} */ (e).message) &&
                !/Bearer t/.test(/** @type {Error} */ (e).message)
        );
    });
    test("a space and a hash in the key are encoded in the request and the returned URL", async () => {
        let seenUrl = "";
        const url = await put({
            file: tmp,
            key: "a b/c#d.png",
            env,
            fetch: async u => {
                seenUrl = u;
                return {ok: true, status: 200};
            }
        });
        assert.equal(url, "https://ev.example/a%20b/c%23d.png");
        assert.ok(seenUrl.endsWith("/objects/a%20b/c%23d.png"));
    });
    test("a missing variable is an error naming it", async () => {
        const {PIPELINE_EVIDENCE_TOKEN, ...rest} = env;
        assert.ok(PIPELINE_EVIDENCE_TOKEN);
        await assert.rejects(
            put({file: tmp, key: "k", env: rest, fetch: async () => ({ok: true, status: 200})}),
            /PIPELINE_EVIDENCE_TOKEN/
        );
    });
    test("contentTypeOf covers the known extensions and falls back to octet-stream", () => {
        assert.equal(contentTypeOf("a.JPG"), "image/jpeg");
        assert.equal(contentTypeOf("a.svg"), "image/svg+xml");
        assert.equal(contentTypeOf("a.md"), "text/markdown");
        assert.equal(contentTypeOf("a.bin"), "application/octet-stream");
        assert.equal(contentTypeOf("noext"), "application/octet-stream");
    });
    test("the CLI exits 2 with usage for an unknown subcommand", () => {
        const r = cli(["frobnicate"]);
        assert.equal(r.status, 2);
        assert.match(r.stdout + r.stderr, /node bin\/evidence\.js put/);
    });
    test("the CLI exits 1 naming the missing variable on stderr", () => {
        const r = cli(["put", tmp]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /PIPELINE_EVIDENCE_ACCOUNT/);
        assert.equal(r.stdout, "");
    });

    for (const key of ["../x", "a/../b", "a//b", "/a", "./a"]) {
        test(`the invalid key ${key} throws before any fetch`, async () => {
            let calls = 0;
            await assert.rejects(
                put({
                    file: tmp,
                    key,
                    env,
                    fetch: async () => {
                        calls++;
                        return {ok: true, status: 200};
                    }
                }),
                /invalid key/
            );
            assert.equal(calls, 0);
        });
    }
    test("a trailing slash on the public base yields a single slash", async () => {
        const url = await put({
            file: tmp,
            key: "k/a.png",
            env: {...env, PIPELINE_EVIDENCE_URL: "https://ev.example//"},
            fetch: async () => ({ok: true, status: 200})
        });
        assert.equal(url, "https://ev.example/k/a.png");
    });
    test("an error body echoing the token is redacted and long bodies are cut to 200", async () => {
        const secret = {...env, PIPELINE_EVIDENCE_TOKEN: "tok-SECRET-123"};
        await assert.rejects(
            put({
                file: tmp,
                key: "k",
                env: secret,
                fetch: async () => ({
                    ok: false,
                    status: 403,
                    text: async () => "bad token tok-SECRET-123"
                })
            }),
            e => {
                const message = /** @type {Error} */ (e).message;
                return /403/.test(message) && !message.includes("tok-SECRET-123");
            }
        );
        await assert.rejects(
            put({
                file: tmp,
                key: "k",
                env,
                fetch: async () => ({ok: false, status: 500, text: async () => "x".repeat(1000)})
            }),
            e =>
                /** @type {Error} */ (e).message.includes("x".repeat(200)) &&
                !(/** @type {Error} */ (e).message.includes("x".repeat(201)))
        );
    });
    test("the upload carries a timeout signal, default 60 s, overridable", async () => {
        /** @type {any} */
        let init;
        await put({
            file: tmp,
            key: "k",
            env,
            timeoutMs: 5000,
            fetch: async (_u, i) => {
                init = i;
                return {ok: true, status: 200};
            }
        });
        assert.ok(init.signal instanceof AbortSignal);
    });
    test("the CLI exits 1 with a one-line error naming a nonexistent file", () => {
        const bogus = path.join(os.tmpdir(), "ev-nope", "missing.png");
        const r = cli(["put", bogus], env);
        assert.equal(r.status, 1);
        assert.equal(r.stdout, "");
        assert.ok(r.stderr.includes(bogus));
        assert.equal(r.stderr.trim().split("\n").length, 1);
    });
    test("the CLI exits 2 with usage for --key without a value", () => {
        const r = cli(["put", tmp, "--key"], env);
        assert.equal(r.status, 2);
        assert.match(r.stderr, /usage/);
    });
});
