// test/cli/spawn.test.js
// A spawn that reaches its time limit keeps what the process printed, so a CI log can
// say where it stalled (#298); every other result comes back as spawnSync gave it.
const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const {spawnKeepingOutput, timeoutError} = require("./spawn.ts");

/** @typedef {import("./spawn.ts").TimeoutError} TimeoutError */

/** @type {import("node:child_process").SpawnSyncOptionsWithStringEncoding} */
const options = {encoding: "utf8", timeout: 500, killSignal: "SIGKILL"};

/** The error a node spawn throws; the test fails when it throws none.
 *
 * @param {string[]} args - The arguments for node.
 * @returns {TimeoutError} - The thrown error.
 */
function thrownBy(args) {
    let thrown;
    try {
        spawnKeepingOutput(process.execPath, args, options);
    } catch (error) {
        thrown = error;
    }
    assert.ok(thrown, "the spawn did not throw");
    return /** @type {TimeoutError} */ (thrown);
}

describe("spawnKeepingOutput", () => {
    test("a timeout throws ETIMEDOUT with the output printed so far", () => {
        const script =
            "console.log('started'); console.error('waiting'); setInterval(() => {}, 1000)";
        const error = thrownBy(["-e", script]);
        assert.equal(error.code, "ETIMEDOUT");
        assert.match(error.message, /timed out after 500 ms/);
        assert.match(error.message, /started/);
        assert.match(error.message, /waiting/);
        assert.match(error.stdout, /started/);
        assert.match(error.stderr, /waiting/);
        assert.deepEqual(error.args, ["-e", script]);
    });
    test("a timeout with no output says so in both blocks", () => {
        const error = thrownBy(["-e", "setInterval(() => {}, 1000)"]);
        assert.equal(error.code, "ETIMEDOUT");
        assert.match(error.message, /--- stdout ---\n\(no output\)/);
        assert.match(error.message, /--- stderr ---\n\(no output\)/);
    });
    test("a missing binary returns its ENOENT error without throwing", () => {
        const result = spawnKeepingOutput("/nonexistent/sozi-test-binary", [], options);
        assert.equal(/** @type {Error & {code: string}} */ (result.error).code, "ENOENT");
    });
    test("a spawn that exits in time returns its status and output", () => {
        const result = spawnKeepingOutput(
            process.execPath,
            ["-e", "console.log('done'); process.exit(3)"],
            options
        );
        assert.equal(result.error, undefined);
        assert.equal(result.status, 3);
        assert.equal(result.stdout, "done\n");
    });
});

describe("timeoutError", () => {
    test("names the command, its arguments and the limit, then the output", () => {
        const error = timeoutError("chrome", ["--headless", "file:///a.html"], 1500, {
            stdout: "out line\n",
            stderr: ""
        });
        assert.equal(error.code, "ETIMEDOUT");
        assert.equal(
            error.message,
            "chrome --headless file:///a.html timed out after 1500 ms\n" +
                "--- stdout ---\nout line\n" +
                "--- stderr ---\n(no output)"
        );
        assert.equal(error.stdout, "out line\n");
        assert.equal(error.stderr, "");
    });
});
