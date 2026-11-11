// test/cli/helpers.test.js
// The time limits the CLI tests give a spawned Electron: a scale from the environment
// stretches every limit on a slow runner (#232), and the command's own --timeout follows.
const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const {limit, withCommandTimeout} = require("./helpers");

describe("CLI test time limits", () => {
    test("a limit is the given milliseconds when no scale is set", () => {
        assert.equal(limit(60000, {}), 60000);
    });
    test("SOZI_TEST_TIMEOUT_SCALE stretches a limit", () => {
        assert.equal(limit(60000, {SOZI_TEST_TIMEOUT_SCALE: "3"}), 180000);
        assert.equal(limit(90000, {SOZI_TEST_TIMEOUT_SCALE: "1.5"}), 135000);
        assert.equal(limit(1, {SOZI_TEST_TIMEOUT_SCALE: String(2 ** 31 - 1)}), 2147483647);
    });
    test("a scale that cannot make a usable limit leaves the limit alone", () => {
        assert.equal(limit(60000, {SOZI_TEST_TIMEOUT_SCALE: "0"}), 60000);
        assert.equal(limit(60000, {SOZI_TEST_TIMEOUT_SCALE: "soon"}), 60000);
        assert.equal(limit(60000, {SOZI_TEST_TIMEOUT_SCALE: ""}), 60000);
        assert.equal(limit(60000, {SOZI_TEST_TIMEOUT_SCALE: "Infinity"}), 60000);
        assert.equal(limit(60000, {SOZI_TEST_TIMEOUT_SCALE: "-Infinity"}), 60000);
        assert.equal(limit(60000, {SOZI_TEST_TIMEOUT_SCALE: "NaN"}), 60000);
        assert.equal(limit(60000, {SOZI_TEST_TIMEOUT_SCALE: "1e7"}), 60000);
        assert.equal(limit(60000, {SOZI_TEST_TIMEOUT_SCALE: "1e400"}), 60000);
    });
    test("a capture command gets --timeout 10 s below the stretched limit", () => {
        assert.deepEqual(withCommandTimeout(["export", "a.svg"], 180000), [
            "export",
            "--timeout",
            "170",
            "a.svg"
        ]);
        assert.deepEqual(withCommandTimeout(["build", "a.svg"], 180000), ["build", "a.svg"]);
    });
});
