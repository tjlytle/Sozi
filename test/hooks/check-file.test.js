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
 * @returns {{status: ?number, stderr: string}} - What the hook reported.
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
 * @returns {{status: ?number, stderr: string}} - What the hook reported.
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

/** Run the hook in advise mode on a file and return its notes.
 *
 * @param {string} file - The file to advise on.
 * @param {string} [diffFile] - A unified diff of the file to use instead of the one against HEAD.
 * @returns {string[]} - One note per line.
 */
function advise(file, diffFile) {
    const args = [hook, "--advise", file, ...(diffFile ? ["--diff", diffFile] : [])];
    const result = spawnSync("python3", args, {encoding: "utf8", timeout: 120000});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split("\n").filter(Boolean);
}

describe("edit hook: advice, not failure (standard 2.8)", () => {
    test("a file over the size guideline gets a note, in the hook output too", () => {
        const body =
            Array.from({length: 420}, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";
        const file = path.join(root, "src", "js", "zz-big.js");
        fs.writeFileSync(file, body);
        try {
            const notes = advise(file);
            assert.ok(
                notes.some(n => /420 lines; the guideline is 400/.test(n)),
                notes.join("\n")
            );
            const r = run(file);
            assert.equal(r.status, 0, r.stderr);
        } finally {
            fs.unlinkSync(file);
        }
    });
    test("a class with many public methods gets a note", () => {
        const methods = Array.from(
            {length: 12},
            (_, i) => `    /** Method ${i}. */\n    m${i}() {\n        return ${i};\n    }`
        ).join("\n\n");
        const file = path.join(root, "src", "js", "ZzWide.js");
        fs.writeFileSync(file, `/** A wide class. */\nexport class ZzWide {\n${methods}\n}\n`);
        try {
            assert.ok(advise(file).some(n => /class `ZzWide` has 12 public methods/.test(n)));
        } finally {
            fs.unlinkSync(file);
        }
    });
    test("code changed under an unchanged summary comment gets a note; a changed comment does not", () => {
        const file = path.join(root, "src", "js", "zz-stale.js");
        const diff = path.join(root, "src", "js", "zz-stale.diff");
        fs.writeFileSync(
            file,
            "/** Adds one.\n *\n * @param {number} n - A number.\n * @returns {number} - n plus one.\n */\nexport function addOne(n) {\n    return n + 1;\n}\n"
        );
        try {
            fs.writeFileSync(
                diff,
                "--- a\n+++ b\n@@ -7,1 +7,1 @@\n-    return n + 2;\n+    return n + 1;\n"
            );
            assert.ok(
                advise(file, diff).some(n =>
                    /code of `addOne` changed but the summary comment above it \(line 1\)/.test(n)
                )
            );
            fs.writeFileSync(
                diff,
                "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-x\n+y\n@@ -7,1 +7,1 @@\n-x\n+y\n"
            );
            assert.ok(!advise(file, diff).some(n => /summary comment/.test(n)));
        } finally {
            fs.unlinkSync(file);
            fs.unlinkSync(diff);
        }
    });
});

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
