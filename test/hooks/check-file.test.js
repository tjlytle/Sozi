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
const scratch = root;

/** The path of a fixture file under the scratch root's src/js.
 *
 * @param {string} name - The file name.
 * @returns {string} - Its absolute path.
 */
function fixture(name) {
    return path.join(scratch, "src", "js", name);
}

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

/** Run the hook in advise mode with the given arguments and return what it reported.
 *
 * @param {string[]} args - The arguments after `--advise`.
 * @returns {{status: ?number, stdout: string, stderr: string}} - What the hook reported.
 */
function adviseRaw(args) {
    const result = spawnSync("python3", [hook, "--advise", ...args], {
        encoding: "utf8",
        timeout: 120000
    });
    return {status: result.status, stdout: result.stdout, stderr: result.stderr};
}

/** Run the hook in advise mode on one or more files and return their notes.
 *
 * @param {string|string[]} files - The file or files to advise on.
 * @param {string} [diffFile] - A unified diff of the file to use instead of the one against HEAD.
 * @returns {string[]} - One note per line.
 */
function advise(files, diffFile) {
    const list = Array.isArray(files) ? files : [files];
    const result = adviseRaw([...list, ...(diffFile ? ["--diff", diffFile] : [])]);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.split("\n").filter(Boolean);
}

/** Write a scratch file and a diff of it, and return the hook's notes on that diff.
 *
 * @param {string} content - The file content.
 * @param {string} diffText - A unified diff of the file.
 * @returns {string[]} - One note per line.
 */
function adviseOnDiff(content, diffText) {
    const file = path.join(root, "src", "js", "zz-body-end.js");
    const diff = path.join(root, "src", "js", "zz-body-end.diff");
    fs.writeFileSync(file, content);
    fs.writeFileSync(diff, diffText);
    try {
        return advise(file, diff);
    } finally {
        fs.unlinkSync(file);
        fs.unlinkSync(diff);
    }
}

/** A `-U0` diff that changes one line of a file.
 *
 * @param {number} line - The 1-based line that changed.
 * @returns {string} - The diff.
 */
function oneLineDiff(line) {
    return `--- a\n+++ b\n@@ -${line},1 +${line},1 @@\n-x\n+y\n`;
}

/** Assert the hook refused its arguments: exit 2, the usage line on stderr, nothing on stdout.
 *
 * @param {string[]} args - The arguments after `--advise`.
 */
function assertUsage(args) {
    const result = adviseRaw(args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /usage: .*--advise FILE\.\.\. \[--diff DIFF_FILE\]/);
    assert.doesNotMatch(result.stderr, /Traceback/);
    assert.equal(result.stdout, "");
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
    const helperThenDescribe =
        "/** Doubles a number.\n *\n * @param {number} n - A number.\n * @returns {number} - Twice n.\n */\n" +
        "function twice(n) {\n    return n * 2;\n}\n\n" +
        'describe("x", () => {\n    test("doubles", () => {\n        assert.equal(twice(2), 4);\n    });\n});\n';
    test("a change inside a describe after a documented helper does not blame the helper", () => {
        const notes = adviseOnDiff(helperThenDescribe, oneLineDiff(12));
        assert.ok(!notes.some(n => /summary comment/.test(n)), notes.join("\n"));
    });
    test("a change inside the helper's body before a describe still gets a note", () => {
        const notes = adviseOnDiff(helperThenDescribe, oneLineDiff(7));
        assert.ok(
            notes.some(n => /code of `twice` changed but the summary comment/.test(n)),
            notes.join("\n")
        );
    });
    test("a change after a wrapped parameter list gets a note", () => {
        const notes = adviseOnDiff(
            "/** Adds two numbers. */\nfunction f(\n    a,\n    b\n) {\n    return a + b;\n}\n",
            oneLineDiff(6)
        );
        assert.ok(
            notes.some(n => /code of `f` changed but the summary comment/.test(n)),
            notes.join("\n")
        );
    });
    test("a change to a call after a documented one-line const does not blame the const", () => {
        const notes = adviseOnDiff(
            "/** The most retries. */\nconst LIMIT = 3;\n\nconsole.log(LIMIT);\n",
            oneLineDiff(4)
        );
        assert.ok(!notes.some(n => /summary comment/.test(n)), notes.join("\n"));
    });
});

describe("edit hook: advise on several files", () => {
    const big = path.join(root, "src", "js", "zz-many-big.js");
    const wide = path.join(root, "src", "js", "ZzManyWide.js");
    const stale = path.join(root, "src", "js", "zz-many-stale.js");
    const diff = path.join(root, "src", "js", "zz-many-stale.diff");

    /** Write the scratch files, run the test body, and remove them.
     *
     * @param {() => void} body - The test body.
     */
    function withFiles(body) {
        fs.writeFileSync(
            big,
            Array.from({length: 420}, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n"
        );
        const methods = Array.from(
            {length: 12},
            (_, i) => `    /** Method ${i}. */\n    m${i}() {\n        return ${i};\n    }`
        ).join("\n\n");
        fs.writeFileSync(wide, `/** A wide class. */\nexport class ZzWide {\n${methods}\n}\n`);
        fs.writeFileSync(
            stale,
            "/** Adds one. */\nexport function addOne(n) {\n    return n + 1;\n}\n"
        );
        fs.writeFileSync(
            diff,
            "--- a\n+++ b\n@@ -3,1 +3,1 @@\n-    return n + 2;\n+    return n + 1;\n"
        );
        try {
            body();
        } finally {
            [big, wide, stale, diff].forEach(f => fs.unlinkSync(f));
        }
    }

    test("gives the notes of every file, in the order the files are passed", () => {
        withFiles(() => {
            for (const files of [
                [big, wide],
                [wide, big]
            ]) {
                const notes = advise(files);
                assert.ok(
                    notes.some(n => /zz-many-big\.js is 420 lines/.test(n)),
                    notes.join("\n")
                );
                assert.ok(
                    notes.some(n => /ZzManyWide\.js: class `ZzWide` has 12 public methods/.test(n)),
                    notes.join("\n")
                );
                // A size or method-count note starts with its file's path; other notes
                // may name the file further in, so only the leading path attributes one.
                const [firstIdx, secondIdx] = files.map(file => {
                    const rel = path.relative(root, file);
                    return notes.flatMap((n, i) => (n.startsWith(rel) ? [i] : []));
                });
                assert.ok(firstIdx.length > 0 && secondIdx.length > 0, notes.join("\n"));
                assert.ok(Math.max(...firstIdx) < Math.min(...secondIdx), notes.join("\n"));
            }
        });
    });
    test("refuses --diff with more than one file", () => {
        withFiles(() => assertUsage([big, wide, "--diff", diff]));
    });
    test("refuses --diff without a value", () => {
        withFiles(() => assertUsage([stale, "--diff"]));
    });
    test("refuses no file", () => {
        assertUsage([]);
    });
    test("takes --diff before the file as after it", () => {
        withFiles(() => {
            const after = adviseRaw([stale, "--diff", diff]);
            const before = adviseRaw(["--diff", diff, stale]);
            assert.equal(after.status, 0, after.stderr);
            assert.match(after.stdout, /code of `addOne` changed but the summary comment/);
            assert.deepEqual(before, after);
        });
    });
});

describe("edit hook", () => {
    test("writes its fixtures outside the working tree", () => {
        assert.ok(path.relative(root, scratch).startsWith(".."), scratch);
        assert.equal(path.dirname(fixture("zz-hook-pass.js")), path.join(scratch, "src", "js"));
        assert.ok(fs.statSync(path.join(scratch, "src", "js")).isDirectory());
    });
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
