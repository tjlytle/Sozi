// Tests of pipeline/check-changed.py: the bin/check findings on the lines a session changed.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
const script = path.join(root, "pipeline", "check-changed.py");

/**
 * Run the script on a scratch file under src/js against a hand-written diff.
 * @param {string} name - The file name.
 * @param {string} content - The file content.
 * @param {string} diffText - A unified diff of the file; its hunks are the changed lines.
 * @returns {{status: ?number, stdout: string}} - What the script printed.
 */
function check(name, content, diffText) {
    const rel = path.join("src", "js", name);
    const diff = path.join(root, ".agents", "tmp", `${name}.diff`);
    fs.mkdirSync(path.dirname(diff), {recursive: true});
    fs.writeFileSync(path.join(root, rel), content);
    fs.writeFileSync(diff, diffText);
    try {
        const result = spawnSync("python3", [script, rel, diff], {cwd: root, encoding: "utf8"});
        return {status: result.status, stdout: result.stdout};
    } finally {
        fs.unlinkSync(path.join(root, rel));
        fs.unlinkSync(diff);
    }
}

/**
 * Run `check_findings` on bin/check output and a set of changed lines.
 * @param {string} output - What bin/check printed.
 * @param {number[]} changed - The changed line numbers.
 * @returns {string} - What survives the filter.
 */
function findings(output, changed) {
    const code =
        "import importlib.util, json, sys\n" +
        "sys.dont_write_bytecode = True\n" +
        "spec = importlib.util.spec_from_file_location('m', sys.argv[1])\n" +
        "m = importlib.util.module_from_spec(spec)\n" +
        "spec.loader.exec_module(m)\n" +
        "print(m.check_findings(sys.argv[2], set(json.loads(sys.argv[3]))), end='')\n";
    const result = spawnSync("python3", ["-c", code, script, output, JSON.stringify(changed)], {
        encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}

/** Line 2 breaks no-var, line 4 breaks eqeqeq. */
const OLD_AND_NEW =
    "export const answer = 42;\nvar x = answer;\nexport const y = x;\nexport const z = y == 2;\n";

describe("check-changed: bin/check findings on changed lines only", () => {
    test("an old error outside the hunks is dropped, a new one inside is printed", () => {
        const r = check("zz-check-new.js", OLD_AND_NEW, "--- a\n+++ b\n@@ -3,0 +4,1 @@\n+x\n");
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stdout, /4:\d+\s+error.*eqeqeq/);
        assert.doesNotMatch(r.stdout, /no-var/);
        assert.doesNotMatch(r.stdout, /problems?/);
    });
    test("the only error is outside the hunks: nothing printed, exit 0", () => {
        const r = check("zz-check-old.js", OLD_AND_NEW, "--- a\n+++ b\n@@ -3,1 +3,1 @@\n-x\n+y\n");
        assert.equal(r.status, 0, r.stdout);
        assert.equal(r.stdout, "");
    });
    test("a Prettier failure has no line and is reported anyway", () => {
        const r = check(
            "zz-check-format.js",
            "export const answer   = 42;\nexport const y = answer;\n",
            "--- a\n+++ b\n@@ -2,1 +2,1 @@\n-x\n+y\n"
        );
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stdout, /== prettier: FAILED/);
    });
    test("a deletion-only hunk counts the line it sits on", () => {
        const r = check("zz-check-del.js", OLD_AND_NEW, "--- a\n+++ b\n@@ -5,1 +4,0 @@\n-x\n");
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stdout, /eqeqeq/);
    });
    test("tsc findings are read by their line; a line-0 finding is kept", () => {
        const output =
            "== tsc\nsrc/js/a.ts(3,5): error TS2322: old.\nsrc/js/a.ts(7,1): error TS2322: new.\n== tsc: FAILED\n" +
            "== eslint\n\n/x/a.js\n  0:0  warning  File ignored\n\n✖ 1 problem (0 errors, 1 warning)\n\n== eslint: FAILED\n";
        const out = findings(output, [7]);
        assert.match(out, /\(7,1\)/);
        assert.doesNotMatch(out, /\(3,5\)/);
        assert.match(out, /0:0 {2}warning/);
    });
});
