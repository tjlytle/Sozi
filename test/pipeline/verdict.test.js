// test/pipeline/verdict.test.js: which results cost no try, which are logged out, which come
// from a stub harness, and the harness pause a usage limit brings.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {emptyState} from "../../pipeline/lib/state.js";
import {costsNoTry, loggedOut, stubHarness, takeResult} from "../../pipeline/lib/verdict.js";

/**
 * A result with the given usage status.
 * @param {string} status - The usage status.
 * @returns {any} - The result.
 */
const withStatus = status => ({
    exit: 0,
    usage: {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 0, status},
    hooks: "ok"
});

describe("verdict", () => {
    test("only a rate limit or a dead login costs no try", () => {
        assert.equal(costsNoTry(withStatus("rate-limited")), true);
        assert.equal(costsNoTry(withStatus("auth")), true);
        assert.equal(costsNoTry(withStatus("unsupported")), false);
        assert.equal(costsNoTry(withStatus("ok")), false);
        assert.equal(costsNoTry(null), false);
    });
    test("a session is logged out when it reports auth", () => {
        assert.equal(loggedOut(withStatus("auth")), true);
        assert.equal(loggedOut(withStatus("error")), false);
        assert.equal(loggedOut(null), false);
    });
    test("a stub harness is one that reports unsupported", () => {
        assert.equal(stubHarness(withStatus("unsupported")), true);
        assert.equal(stubHarness(withStatus("rate-limited")), false);
        assert.equal(stubHarness(withStatus("ok")), false);
        assert.equal(stubHarness(null), false);
    });
});

describe("takeResult", () => {
    const NOW = Date.parse("2026-11-10T10:00:00Z");
    /**
     * A context with an outbox holding a result of the given usage.
     *
     * @param {Record<string, any>} usage - The usage fields over a clean default.
     * @returns {{ctx: any, outbox: string}} - The context and the outbox.
     */
    function withResult(usage) {
        const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "verdict-"));
        fs.writeFileSync(
            path.join(outbox, "result.json"),
            JSON.stringify({
                exit: usage.status === "rate-limited" ? 75 : 0,
                session: "s1",
                usage: {tokensIn: 1, tokensOut: 1, costUsd: 0, turns: 1, status: "ok", ...usage}
            })
        );
        const ctx = {
            state: emptyState(),
            settings: {rateLimitBackoffMinutes: 15},
            clock: {now: () => NOW},
            log: () => {}
        };
        return {ctx, outbox};
    }

    test("a limit pauses only its harness and leaves GitHub's back-off alone", () => {
        const {ctx, outbox} = withResult({status: "rate-limited", limit: "usage limit"});
        takeResult(/** @type {any} */ (ctx), outbox, "#25", "claude");
        const limits = /** @type {any} */ (ctx.state.run).limits;
        assert.deepEqual(Object.keys(limits), ["claude"]);
        assert.equal(limits.claude.until, "2026-11-10T10:15:00.000Z");
        assert.equal(limits.claude.reported, false);
        assert.equal(ctx.state.sync.backoffUntil, null);
        assert.equal(ctx.state.run.startsPausedUntil, undefined);
    });
    test("the reset the limit text names is the pause", () => {
        const {ctx, outbox} = withResult({
            status: "rate-limited",
            limit: "You've hit your limit · resets 3pm (Europe/Paris)"
        });
        takeResult(/** @type {any} */ (ctx), outbox, "#25", "claude");
        assert.deepEqual(ctx.state.run.limits.claude, {
            until: "2026-11-10T14:00:00.000Z",
            streak: 1,
            reported: true
        });
    });
    test("a session that ended ok clears its harness's pause", () => {
        const {ctx, outbox} = withResult({status: "ok"});
        ctx.state.run.limits = {
            claude: {until: "2026-11-10T09:00:00.000Z", streak: 2, reported: false},
            codex: {until: "2026-11-10T11:00:00.000Z", streak: 1, reported: false}
        };
        takeResult(/** @type {any} */ (ctx), outbox, "#25", "claude");
        assert.deepEqual(Object.keys(ctx.state.run.limits), ["codex"]);
    });
});
