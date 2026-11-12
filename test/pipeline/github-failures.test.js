/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// test/pipeline/github-failures.test.js: how the GitHub client fails: rate limits, plain
// errors, bad JSON, and the default runner.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {RateLimited, defaultRun} from "../../pipeline/lib/github.js";
import {calls, json, make} from "./github-world.js";

describe("github: failures", () => {
    test("a rate-limit reply becomes RateLimited with a reset time", async () => {
        const gh = make([
            {code: 1, stderr: "HTTP 403: API rate limit exceeded"},
            {stdout: JSON.stringify({resources: {core: {reset: 1800000000}}})}
        ]);
        await assert.rejects(
            gh.labelsOf(25),
            e => e instanceof RateLimited && e.resetAt.getTime() === 1800000000000
        );
    });
    test("a 403 with rate limit budget left is a plain error, not a back-off", async () => {
        const gh = make([
            {code: 1, stderr: "HTTP 403: Resource not accessible by integration"},
            json({
                resources: {
                    core: {remaining: 5000, reset: 1800000000},
                    graphql: {remaining: 5000, reset: 1800000000}
                }
            })
        ]);
        await assert.rejects(
            gh.labelsOf(25),
            e =>
                e instanceof Error &&
                !(e instanceof RateLimited) &&
                /not accessible/.test(e.message)
        );
    });
    test("a 403 with the GraphQL budget spent is RateLimited until the later reset", async () => {
        const gh = make([
            {code: 1, stderr: "HTTP 403: Forbidden"},
            json({
                resources: {
                    core: {remaining: 4000, reset: 1800000000},
                    graphql: {remaining: 0, reset: 1800000600}
                }
            })
        ]);
        await assert.rejects(
            gh.labelsOf(25),
            e => e instanceof RateLimited && e.resetAt.getTime() === 1800000600000
        );
    });
    test("a 403 whose rate_limit read fails is a plain error", async () => {
        const gh = make([
            {code: 1, stderr: "HTTP 403"},
            {code: 1, stderr: "nope"}
        ]);
        await assert.rejects(gh.labelsOf(25), e => !(e instanceof RateLimited));
    });

    test("defaultRun delivers stdin, captures stderr and resolves a non-zero code", async () => {
        const script =
            "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{process.stdout.write(d);process.stderr.write('err');process.exit(3)})";
        const r = await defaultRun([process.execPath, "-e", script], {input: "hello"});
        assert.deepEqual(r, {code: 3, stdout: "hello", stderr: "err"});
    });
    test("defaultRun resolves a missing binary with a non-zero code and the error", async () => {
        const r = await defaultRun(["/nonexistent/binary"]);
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /ENOENT|nonexistent/);
    });

    test("a plain failure names the command and carries stderr", async () => {
        const gh = make([{code: 1, stderr: "boom"}]);
        await assert.rejects(
            gh.labelsOf(7),
            (/** @type {Error} */ e) =>
                !(e instanceof RateLimited) &&
                /gh-as ops issue view/.test(e.message) &&
                /boom/.test(e.message)
        );
    });
    test("bad JSON is an error naming the command", async () => {
        const gh = make([{stdout: "not json"}]);
        await assert.rejects(
            gh.labelsOf(7),
            e => e instanceof Error && /gh-as ops issue view/.test(e.message)
        );
    });
    test("rate limit without a working rate_limit call falls back to 15 minutes", async () => {
        const gh = make([
            {code: 1, stderr: "HTTP 429"},
            {code: 1, stderr: "nope"}
        ]);
        const before = Date.now();
        await assert.rejects(
            gh.labelsOf(7),
            e =>
                e instanceof RateLimited &&
                e.resetAt.getTime() - before >= 15 * 60000 - 1000 &&
                e.resetAt.getTime() - before <= 15 * 60000 + 5000
        );
        assert.deepEqual(calls[1].cmd, ["gh-as", "ops", "api", "rate_limit"]);
    });
});
