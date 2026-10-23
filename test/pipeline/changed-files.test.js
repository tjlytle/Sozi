// Tests of pipeline/changed-files.sh: the files a session changed, without what a merge brought in.

import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
const script = path.join(root, "pipeline/changed-files.sh");

/** @type {string[]} */
const dirs = [];

after(() => {
    for (const dir of dirs) {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

/**
 * Make a scratch repository with one base commit on master and a side branch that adds
 * merged.txt, as master would after the session started.
 * @returns {{dir: string, start: string, git: (...args: string[]) => string}} - The repo,
 *     its start commit and a git runner inside it.
 */
function repo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changed-files-"));
    dirs.push(dir);
    const git = (/** @type {string[]} */ ...args) =>
        execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
            cwd: dir,
            encoding: "utf8"
        });
    git("init", "-q", "-b", "master");
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const start = git("rev-parse", "HEAD").trim();
    git("switch", "-q", "-c", "side");
    fs.writeFileSync(path.join(dir, "merged.txt"), "from master\n");
    git("add", ".");
    git("commit", "-q", "-m", "side");
    git("switch", "-q", "master");
    return {dir, start, git};
}

/**
 * Commit one file of the session's own.
 * @param {{dir: string, git: (...args: string[]) => string}} r - The repo.
 * @param {string} name - The file name.
 */
function commitOwn(r, name) {
    fs.writeFileSync(path.join(r.dir, name), "mine\n");
    r.git("add", "--", name);
    r.git("commit", "-q", "-m", `own ${name}`);
}

/**
 * Run the script.
 * @param {string} dir - The checkout.
 * @param {string} start - The start commit.
 * @returns {{status: ?number, files: string[], stderr: string}} - Its exit, its lines and stderr.
 */
function changed(dir, start) {
    const r = spawnSync("bash", [script, dir, start], {encoding: "utf8"});
    return {status: r.status, files: r.stdout.split("\n").filter(Boolean), stderr: r.stderr};
}

describe("changed-files.sh", () => {
    test("the session's own commit is listed", () => {
        const r = repo();
        commitOwn(r, "own.txt");
        assert.deepEqual(changed(r.dir, r.start), {status: 0, files: ["own.txt"], stderr: ""});
    });
    test("a file a --no-ff merge brought in is not listed", () => {
        const r = repo();
        commitOwn(r, "own.txt");
        r.git("merge", "-q", "--no-ff", "-m", "merge master", "side");
        assert.deepEqual(changed(r.dir, r.start).files, ["own.txt"]);
    });
    test("own commit, merge, uncommitted edit and untracked file: the three own ones", () => {
        const r = repo();
        commitOwn(r, "own.txt");
        r.git("merge", "-q", "--no-ff", "-m", "merge master", "side");
        fs.appendFileSync(path.join(r.dir, "base.txt"), "edited\n");
        fs.writeFileSync(path.join(r.dir, "new.txt"), "new\n");
        assert.deepEqual(changed(r.dir, r.start).files, ["base.txt", "new.txt", "own.txt"]);
    });
    test("a file committed and then deleted is not listed", () => {
        const r = repo();
        commitOwn(r, "gone.txt");
        r.git("rm", "-q", "gone.txt");
        r.git("commit", "-q", "-m", "drop");
        assert.deepEqual(changed(r.dir, r.start).files, []);
    });
    test("a name with a space is listed whole", () => {
        const r = repo();
        commitOwn(r, "has space.txt");
        fs.writeFileSync(path.join(r.dir, "also spaced.txt"), "x\n");
        assert.deepEqual(changed(r.dir, r.start).files, ["also spaced.txt", "has space.txt"]);
    });
    test("a bad start sha exits 2 with git's error", () => {
        const r = repo();
        const out = changed(r.dir, "not-a-revision");
        assert.equal(out.status, 2);
        assert.match(out.stderr, /not-a-revision|fatal/);
    });
});
