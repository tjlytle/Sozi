import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
const script = path.join(root, "pipeline/hooks-outside.sh");
/**
 * Run a command and return its stdout.
 * @param {string} cwd - Working directory.
 * @param {string} cmd - Command.
 * @param {string[]} args - Arguments.
 * @returns {string} - Standard output.
 */
const run = (cwd, cmd, args) => execFileSync(cmd, args, {cwd, encoding: "utf8"});

/** @type {string[]} */
const dirs = [];

/**
 * Make a shared clone of the repo with the root's node_modules linked in.
 * @returns {string} - The clone's path.
 */
function scratch() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-"));
    dirs.push(dir);
    run(root, "git", ["clone", "-q", "--shared", root, dir]);
    fs.symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
    return dir;
}

/**
 * Run the outside pass without throwing.
 * @param {string} dir - The checkout.
 * @param {string} sha - The start commit.
 * @param {string} report - The report path.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} - The result.
 */
const hooks = (dir, sha, report) =>
    spawnSync("bash", [script, dir, sha, report], {encoding: "utf8"});

/** A file whose first line breaks no-var, committed before the session starts. */
const OLD_ERROR = "var a = 1;\nexport const b = a;\n";

/**
 * Make a scratch clone with src/js/old.js (and a test that covers it) committed,
 * so the start commit already holds an old lint error.
 * @returns {{dir: string, sha: string, file: string}} - The clone, the start commit and the file.
 */
function committedWithOldError() {
    const dir = scratch();
    const file = path.join(dir, "src/js/old.js");
    fs.writeFileSync(file, OLD_ERROR);
    fs.writeFileSync(path.join(dir, "test/unit/old.test.js"), "");
    const git = args => run(dir, "git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args]);
    git(["add", "."]);
    git(["commit", "-q", "-m", "base"]);
    return {dir, sha: git(["rev-parse", "HEAD"]).trim(), file};
}

after(() => {
    for (const dir of dirs) {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

describe("the outside hook pass", () => {
    test("nothing changed: empty report, exit 0", () => {
        const dir = scratch();
        const sha = run(dir, "git", ["rev-parse", "HEAD"]).trim();
        const report = path.join(dir, "report.txt");
        execFileSync("bash", [script, dir, sha, report]);
        assert.equal(fs.readFileSync(report, "utf8"), "");
    });
    test("a bad new file: the report names it and the exit is 1", () => {
        const dir = scratch();
        const sha = run(dir, "git", ["rev-parse", "HEAD"]).trim();
        fs.writeFileSync(path.join(dir, "src/js/bad.js"), "window.x = 1\n");
        const report = path.join(dir, "report.txt");
        assert.throws(
            () => execFileSync("bash", [script, dir, sha, report], {stdio: "pipe"}),
            e => /** @type {any} */ (e).status === 1
        );
        const text = fs.readFileSync(report, "utf8");
        assert.match(text, /^The edit hook would have told you:/);
        assert.match(text, /src\/js\/bad\.js/);
    });
    test("a changed file outside the checked directories: empty report, exit 0", () => {
        const dir = scratch();
        const sha = run(dir, "git", ["rev-parse", "HEAD"]).trim();
        fs.mkdirSync(path.join(dir, "docs"), {recursive: true});
        fs.writeFileSync(path.join(dir, "docs/x.md"), "# x\n");
        const report = path.join(dir, "report.txt");
        execFileSync("bash", [script, dir, sha, report]);
        assert.equal(fs.readFileSync(report, "utf8"), "");
        fs.writeFileSync(path.join(dir, "src/js/bad.js"), "window.x = 1\n");
        assert.throws(() => execFileSync("bash", [script, dir, sha, report], {stdio: "pipe"}));
        const text = fs.readFileSync(report, "utf8");
        assert.match(text, /src\/js\/bad\.js/);
        assert.doesNotMatch(text, /x\.md/);
    });
    test("a modified tracked file with a lint error is reported", () => {
        const dir = scratch();
        const sha = run(dir, "git", ["rev-parse", "HEAD"]).trim();
        fs.appendFileSync(path.join(dir, "src/js/Storage.js"), "\nwindow.x = 1\n");
        const report = path.join(dir, "report.txt");
        assert.equal(hooks(dir, sha, report).status, 1);
        assert.match(fs.readFileSync(report, "utf8"), /bin\/check src\/js\/Storage\.js/);
        assert.match(fs.readFileSync(report, "utf8"), /bin\/check --fix src\/js\/Storage\.js/);
    });
    test("an old lint error is not reported, a new one on another line is", () => {
        const {dir, sha, file} = committedWithOldError();
        fs.appendFileSync(file, "export const c = b == 1;\n");
        const report = path.join(dir, "report.txt");
        assert.equal(hooks(dir, sha, report).status, 1);
        const text = fs.readFileSync(report, "utf8");
        assert.match(text, /3:\d+\s+error.*eqeqeq/);
        assert.doesNotMatch(text, /no-var/);
    });
    test("a clean change to a file with an old lint error: empty report, exit 0", () => {
        const {dir, sha, file} = committedWithOldError();
        fs.writeFileSync(file, OLD_ERROR.replace("= a;", "= a + 1;"));
        const report = path.join(dir, "report.txt");
        assert.equal(hooks(dir, sha, report).status, 0);
        assert.equal(fs.readFileSync(report, "utf8"), "");
    });
    test("formatting broken on a changed line is reported with the fix hint", () => {
        const {dir, sha, file} = committedWithOldError();
        fs.writeFileSync(file, OLD_ERROR.replace("= a;", "=   a;"));
        const report = path.join(dir, "report.txt");
        assert.equal(hooks(dir, sha, report).status, 1);
        const text = fs.readFileSync(report, "utf8");
        assert.match(text, /prettier: FAILED/);
        assert.match(text, /bin\/check --fix src\/js\/old\.js/);
    });
    test("a deleted tracked file is not listed and does not crash", () => {
        const dir = scratch();
        const sha = run(dir, "git", ["rev-parse", "HEAD"]).trim();
        fs.rmSync(path.join(dir, "src/js/Storage.js"));
        const report = path.join(dir, "report.txt");
        assert.equal(hooks(dir, sha, report).status, 0);
        assert.equal(fs.readFileSync(report, "utf8"), "");
    });
    test("a file name with a space is checked", () => {
        const dir = scratch();
        const sha = run(dir, "git", ["rev-parse", "HEAD"]).trim();
        fs.writeFileSync(path.join(dir, "src/js/has space.js"), "window.x = 1\n");
        const report = path.join(dir, "report.txt");
        assert.equal(hooks(dir, sha, report).status, 1);
        assert.match(fs.readFileSync(report, "utf8"), /has space\.js/);
    });
    test("an advise-only note reaches the report", () => {
        const dir = scratch();
        const sha = run(dir, "git", ["rev-parse", "HEAD"]).trim();
        fs.writeFileSync(path.join(dir, "src/js/long.js"), "// filler\n".repeat(450));
        const report = path.join(dir, "report.txt");
        assert.equal(hooks(dir, sha, report).status, 1);
        assert.match(fs.readFileSync(report, "utf8"), /standard 2\.8/);
        assert.doesNotMatch(fs.readFileSync(report, "utf8"), /== bin\/check/);
    });
    test("a root-level file with a checked extension is checked", () => {
        const dir = scratch();
        const sha = run(dir, "git", ["rev-parse", "HEAD"]).trim();
        fs.writeFileSync(path.join(dir, "rootbad.js"), "window.x = 1\n");
        fs.writeFileSync(path.join(dir, "notes.md"), "# n\n");
        const report = path.join(dir, "report.txt");
        assert.equal(hooks(dir, sha, report).status, 1);
        const text = fs.readFileSync(report, "utf8");
        assert.match(text, /rootbad\.js/);
        assert.doesNotMatch(text, /notes\.md/);
    });
    test("advice still sees a change the session already committed", () => {
        const dir = scratch();
        const file = path.join(dir, "src/js/stale.js");
        const code = body =>
            `/**\n * Add one.\n * @param {number} a - A number.\n * @returns {number} - The sum.\n */\nexport function add(a) {\n    return ${body};\n}\n`;
        fs.writeFileSync(file, code("a + 1"));
        const git = args => run(dir, "git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args]);
        git(["add", "."]);
        git(["commit", "-q", "-m", "base"]);
        const sha = git(["rev-parse", "HEAD"]).trim();
        fs.writeFileSync(file, code("a + 2"));
        git(["commit", "-qam", "change"]);
        const report = path.join(dir, "report.txt");
        assert.equal(hooks(dir, sha, report).status, 1);
        assert.match(fs.readFileSync(report, "utf8"), /summary comment/);
    });
    test("a failing git exits 2 with the error, not an empty report", () => {
        const dir = scratch();
        const report = path.join(dir, "report.txt");
        const r = hooks(dir, "not-a-revision", report);
        assert.equal(r.status, 2);
        assert.match(r.stderr, /not-a-revision|fatal/);
    });
});
