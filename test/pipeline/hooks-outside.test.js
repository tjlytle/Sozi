import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
const script = path.join(root, "pipeline/hooks-outside.sh");
/** @type {string[]} */
const dirs = [];

/**
 * Run a command and return its stdout.
 * @param {string} cwd - Working directory.
 * @param {string} cmd - Command.
 * @param {string[]} args - Arguments.
 * @returns {string} - Standard output.
 */
const run = (cwd, cmd, args) => execFileSync(cmd, args, {cwd, encoding: "utf8"});

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
    });
});
