/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// test/cli/chrome.test.js
// The parts of the headless-Chrome helper that need no Chrome: how a Chrome run's result
// skips or fails a test, and how the document title is read from a dumped DOM.
const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const {chromeRan, documentTitle} = require("./chrome.ts");

/** @typedef {import("node:child_process").SpawnSyncReturns<string>} SpawnResult */
/** @typedef {import("node:test").TestContext} TestContext */

/** A stand-in for a test context that records the reasons it was skipped with.
 *
 * @returns {{t: TestContext, skips: string[]}} - The context, and the reasons recorded.
 */
function fakeContext() {
    /** @type {string[]} */
    const skips = [];
    const t = /** @type {TestContext} */ (
        /** @type {unknown} */ ({skip: (/** @type {string} */ reason) => skips.push(reason)})
    );
    return {t, skips};
}

/** A spawnSync result with the given status, stderr and error.
 *
 * @param {object} fields - The fields to set.
 * @param {?number} [fields.status] - The exit status (default: 0).
 * @param {string} [fields.stderr] - What the process printed on stderr.
 * @param {string} [fields.code] - The code of a spawn error; no error when absent.
 * @returns {SpawnResult} - The result.
 */
function result({status = 0, stderr = "", code} = {}) {
    const error = code ? Object.assign(new Error(`spawn ${code}`), {code}) : undefined;
    return /** @type {SpawnResult} */ ({
        pid: 0,
        output: [],
        stdout: "",
        stderr,
        status,
        signal: null,
        error
    });
}

describe("chromeRan", () => {
    for (const code of ["ENOENT", "EACCES"]) {
        test(`a spawn error ${code} skips the test and returns false`, () => {
            const {t, skips} = fakeContext();
            assert.equal(chromeRan(t, result({status: null, code})), false);
            assert.equal(skips.length, 1);
            assert.match(skips[0], new RegExp(code));
        });
    }
    test("another spawn error, such as EPIPE, throws without skipping", () => {
        const {t, skips} = fakeContext();
        assert.throws(() => chromeRan(t, result({status: null, code: "EPIPE"})), /EPIPE/);
        assert.deepEqual(skips, []);
    });
    test("a non-zero exit status throws and names stderr", () => {
        const {t, skips} = fakeContext();
        assert.throws(
            () => chromeRan(t, result({status: 1, stderr: "crashed at startup"})),
            /crashed at startup/
        );
        assert.deepEqual(skips, []);
    });
    test("a zero exit status returns true without skipping", () => {
        const {t, skips} = fakeContext();
        assert.equal(chromeRan(t, result()), true);
        assert.deepEqual(skips, []);
    });
});

describe("documentTitle", () => {
    test("decodes the character references in the title", () => {
        const dom = "<html><head><title>&lt;b&gt;&amp;&quot;</title></head></html>";
        assert.equal(documentTitle(dom), '<b>&"');
    });
    test("returns an empty string for an empty title", () => {
        assert.equal(documentTitle("<html><head><title></title></head></html>"), "");
    });
    test("throws when the DOM has no title", () => {
        assert.throws(() => documentTitle("<html><head></head><body></body></html>"), /title/);
    });
});
