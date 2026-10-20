/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests of the edit hook: the PostToolUse hook that runs `bin/check FILE` on
// a file the model just wrote and reports a failure back (exit 2).

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const hook = path.join(root, ".claude", "hooks", "check-file.py");

/** Run the hook on a written file and return its exit status and stderr.
 *
 * @param {string} filePath - The absolute path the tool wrote.
 * @returns {{status: number, stderr: string}} - What the hook reported.
 */
function run(filePath) {
    const payload = JSON.stringify({
        tool_name: "Write",
        cwd: root,
        tool_input: {file_path: filePath}
    });
    const result = spawnSync("python3", [hook], {
        input: payload,
        encoding: "utf8",
        timeout: 120000
    });
    return {status: result.status, stderr: result.stderr};
}

/** Write a scratch file under src/js, run the hook on it, and remove it.
 *
 * @param {string} name - The file name.
 * @param {string} content - The file content.
 * @returns {{status: number, stderr: string}} - What the hook reported.
 */
function withScratch(name, content) {
    const file = path.join(root, "src", "js", name);
    fs.writeFileSync(file, content);
    try {
        return run(file);
    } finally {
        fs.unlinkSync(file);
    }
}

describe("edit hook", () => {
    test("ignores files it does not check", () => {
        assert.equal(run(path.join(root, "README.md")).status, 0);
        assert.equal(run("/etc/hostname").status, 0);
        assert.equal(run(path.join(root, "locales", "fr.po")).status, 0);
    });
    test("passes a file that meets the standard", () => {
        const r = withScratch("zz-hook-pass.js", "export const answer = 42;\n");
        assert.equal(r.status, 0, r.stderr);
    });
    test("reports a file that fails the standard", () => {
        const r = withScratch(
            "zz-hook-fail.js",
            "export const answer = 42\nvar x = answer == 1;\n"
        );
        assert.equal(r.status, 2);
        assert.match(r.stderr, /bin\/check src\/js\/zz-hook-fail\.js failed/);
        assert.match(r.stderr, /eqeqeq|no-var|prettier/);
    });
});
