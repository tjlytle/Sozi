// test/pipeline/verdict.test.js: which results cost no try, which are logged out, and which come
// from a stub harness.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {costsNoTry, loggedOut, stubHarness} from "../../pipeline/lib/verdict.js";

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
