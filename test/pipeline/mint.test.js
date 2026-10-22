/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import {startMint} from "../../pipeline/lib/mint.js";

describe("the mint endpoint", async () => {
    const asked = [];
    const server = await startMint({
        port: 0,
        host: "127.0.0.1",
        key: "secret",
        repos: ["tjlytle/Sozi"],
        mint: async (bot, repo) => {
            asked.push([bot, repo]);
            return "ghs_fake";
        }
    });
    after(() => server.close());
    const post = (auth, body) =>
        fetch(server.url, {
            method: "POST",
            headers: {Authorization: auth},
            body: JSON.stringify(body)
        });

    test("mints for a persona on the locked repo", async () => {
        const r = await post("Bearer secret", {repo: "tjlytle/Sozi", bot: "builder"});
        assert.equal(r.status, 200);
        assert.equal((await r.json()).token, "ghs_fake");
        assert.deepEqual(asked.at(-1), ["builder", "tjlytle/Sozi"]);
    });
    test("refuses a wrong key, another repo and an unknown bot", async () => {
        assert.equal(
            (await post("Bearer nope", {repo: "tjlytle/Sozi", bot: "builder"})).status,
            401
        );
        assert.equal(
            (await post("Bearer secret", {repo: "sozi-projects/Sozi", bot: "builder"})).status,
            403
        );
        assert.equal(
            (await post("Bearer secret", {repo: "tjlytle/Sozi", bot: "root"})).status,
            400
        );
    });
});

describe("the mint endpoint edge cases", () => {
    /**
     * @param {object} [extra] - Option overrides.
     * @returns {Promise<{server: Awaited<ReturnType<typeof startMint>>, logs: object[]}>} The server and its log.
     */
    async function start(extra = {}) {
        const logs = [];
        const server = await startMint({
            port: 0,
            host: "127.0.0.1",
            key: "secret",
            repos: ["tjlytle/Sozi"],
            mint: async () => "ghs_fake",
            log: e => logs.push(e),
            ...extra
        });
        return {server, logs};
    }
    const auth = {Authorization: "Bearer secret"};
    const good = JSON.stringify({repo: "tjlytle/Sozi", bot: "builder"});

    test("a GET gets 400", async () => {
        const {server} = await start();
        try {
            assert.equal((await fetch(server.url, {headers: auth})).status, 400);
        } finally {
            await server.close();
        }
    });
    test("a body that is not JSON gets 400", async () => {
        const {server} = await start();
        try {
            assert.equal(
                (await fetch(server.url, {method: "POST", headers: auth, body: "not json"})).status,
                400
            );
            assert.equal(
                (
                    await fetch(server.url, {
                        method: "POST",
                        headers: auth,
                        body: JSON.stringify({repo: 1, bot: "ops"})
                    })
                ).status,
                400
            );
            assert.equal(
                (
                    await fetch(server.url, {
                        method: "POST",
                        headers: auth,
                        body: JSON.stringify({repo: "a b/c", bot: "ops"})
                    })
                ).status,
                400
            );
        } finally {
            await server.close();
        }
    });
    test("a missing bearer gets 401", async () => {
        const {server} = await start();
        try {
            const r = await fetch(server.url, {method: "POST", body: good});
            assert.equal(r.status, 401);
            assert.deepEqual(await r.json(), {error: "unknown credential"});
        } finally {
            await server.close();
        }
    });
    test("a mint that rejects gets 502 without the error text", async () => {
        const {server} = await start({
            mint: async () => {
                throw new Error("boom ghs_secret_text");
            }
        });
        try {
            const r = await fetch(server.url, {method: "POST", headers: auth, body: good});
            assert.equal(r.status, 502);
            const text = await r.text();
            assert.deepEqual(JSON.parse(text), {error: "mint failed"});
            assert.ok(!text.includes("boom"));
        } finally {
            await server.close();
        }
    });
    test("a body over 4 KiB gets 413", async () => {
        const {server} = await start();
        try {
            const r = await fetch(server.url, {
                method: "POST",
                headers: auth,
                body: JSON.stringify({repo: "x".repeat(5000)})
            });
            assert.equal(r.status, 413);
        } finally {
            await server.close();
        }
    });
    test("the log gets bot, repo and status, never the key or token", async () => {
        const {server, logs} = await start();
        try {
            await fetch(server.url, {method: "POST", headers: auth, body: good});
            await fetch(server.url, {
                method: "POST",
                headers: {Authorization: "Bearer nope"},
                body: good
            });
            assert.deepEqual(logs[0], {bot: "builder", repo: "tjlytle/Sozi", status: 200});
            assert.equal(logs[1].status, 401);
            const text = JSON.stringify(logs);
            assert.ok(
                !text.includes("secret") && !text.includes("ghs_fake") && !text.includes("nope")
            );
        } finally {
            await server.close();
        }
    });
    test("the reply carries an expiry about 50 minutes out", async () => {
        const {server} = await start();
        try {
            const r = await (
                await fetch(server.url, {method: "POST", headers: auth, body: good})
            ).json();
            const minutes = (Date.parse(r.expires_at) - Date.now()) / 60000;
            assert.ok(minutes > 49 && minutes <= 50);
        } finally {
            await server.close();
        }
    });
    test("close resolves and the port is then refused", async () => {
        const {server} = await start();
        await server.close();
        await assert.rejects(fetch(server.url, {method: "POST", headers: auth, body: good}));
    });
});

describe("the mint endpoint hardening", () => {
    const auth = {Authorization: "Bearer secret"};
    const good = JSON.stringify({repo: "tjlytle/Sozi", bot: "builder"});
    /**
     * @param {object} extra - Option overrides.
     * @returns {Promise<Awaited<ReturnType<typeof startMint>>>} The server.
     */
    const start = extra =>
        startMint({
            port: 0,
            host: "127.0.0.1",
            key: "secret",
            repos: ["tjlytle/Sozi"],
            mint: async () => "ghs_fake",
            ...extra
        });

    test("a log that throws neither blocks a 200 nor kills the server", async () => {
        const server = await start({
            log: () => {
                throw new Error("log broke");
            }
        });
        try {
            assert.equal(
                (await fetch(server.url, {method: "POST", headers: auth, body: good})).status,
                200
            );
            assert.equal(
                (await fetch(server.url, {method: "POST", headers: auth, body: good})).status,
                200
            );
        } finally {
            await server.close();
        }
    });
    test("a mint that never resolves gets 502 within the timeout", async () => {
        const logs = [];
        const server = await start({
            mint: () => new Promise(() => {}),
            mintTimeoutMs: 50,
            log: e => logs.push(e)
        });
        try {
            const r = await fetch(server.url, {method: "POST", headers: auth, body: good});
            assert.equal(r.status, 502);
            assert.equal(logs[0].reason, "timeout");
        } finally {
            await server.close();
        }
    });
    test("an empty or non-string token gets 502", async () => {
        for (const token of ["", "  \n", undefined, 42]) {
            const logs = [];
            const server = await start({mint: async () => token, log: e => logs.push(e)});
            try {
                const r = await fetch(server.url, {method: "POST", headers: auth, body: good});
                assert.equal(r.status, 502);
                assert.equal(logs[0].reason, "empty-token");
            } finally {
                await server.close();
            }
        }
    });
    test("a bearer without the Bearer prefix gets 401", async () => {
        const server = await start({});
        try {
            const r = await fetch(server.url, {
                method: "POST",
                headers: {Authorization: "secret"},
                body: good
            });
            assert.equal(r.status, 401);
        } finally {
            await server.close();
        }
    });
    test("failures log a fixed reason code, never the error message", async () => {
        const logs = [];
        const server = await start({
            mint: async () => {
                throw new Error("leaky ghs_x");
            },
            log: e => logs.push(e)
        });
        try {
            await fetch(server.url, {method: "POST", headers: auth, body: good});
            await fetch(server.url, {method: "POST", headers: auth, body: "nope"});
            assert.equal(logs[0].reason, "mint-error");
            assert.equal(logs[1].reason, "bad-body");
            assert.ok(!JSON.stringify(logs).includes("leaky"));
        } finally {
            await server.close();
        }
    });
});
