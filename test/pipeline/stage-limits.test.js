// test/pipeline/stage-limits.test.js: pipeline/stage.sh around a usage limit: the work a
// stopped session carries to the next, its restore, and the resume of the stopped session.
import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {cleanUp, result, runStage, world} from "./stage-world.js";

after(cleanUp);

describe("a session stopped at a usage limit carries its work", () => {
    const LIMITED_WORK = [
        "echo carried >carried.txt",
        "git add carried.txt",
        "git -c user.name=t -c user.email=t@t commit -q -m 'Add carried.txt'",
        "echo loose >loose.txt"
    ].join(" && ");
    /**
     * Run a session that commits a file, leaves another untracked, and stops at its limit.
     * @returns {string} - The outbox holding its carry files.
     */
    function limited() {
        const w = world(true);
        runStage({...w.env, FAKE_EXIT: "75", FAKE_SCRIPT: LIMITED_WORK});
        return w.outbox;
    }
    /**
     * A fresh world whose outbox holds the carry of an earlier session and the resume message.
     * @param {string} from - The outbox of the stopped session.
     * @returns {ReturnType<typeof world>} - The world.
     */
    function resumed(from) {
        const w = world(true);
        for (const name of ["carry.bundle", "carry.patch"]) {
            fs.copyFileSync(path.join(from, name), path.join(w.outbox, name));
        }
        fs.writeFileSync(path.join(w.outbox, "resume.md"), "carry on\n");
        return w;
    }
    /**
     * The adapter calls the session made, one line of arguments each.
     * @param {string} outbox - The outbox.
     * @returns {string[]} - The lines.
     */
    const calls = outbox =>
        fs.readFileSync(path.join(outbox, "calls"), "utf8").trimEnd().split("\n");

    test("exit 75 leaves the unpushed commits and the uncommitted files", () => {
        const outbox = limited();
        assert.equal(result(outbox).exit, 75);
        assert.ok(fs.statSync(path.join(outbox, "carry.bundle")).size > 0);
        assert.match(fs.readFileSync(path.join(outbox, "carry.patch"), "utf8"), /loose\.txt/);
    });
    test("exit 75 with nothing done leaves no carry files", () => {
        const w = world(true);
        runStage({...w.env, FAKE_EXIT: "75"});
        assert.equal(fs.existsSync(path.join(w.outbox, "carry.bundle")), false);
        assert.equal(fs.existsSync(path.join(w.outbox, "carry.patch")), false);
    });
    test("a resumed container applies the carry and resumes the session", () => {
        const w = resumed(limited());
        runStage({...w.env, PIPELINE_RESUME_SESSION: "s1"});
        const work = w.env.WORK;
        const git = (/** @type {string[]} */ ...args) =>
            execFileSync("git", ["-C", work, ...args], {encoding: "utf8"}).trim();
        assert.equal(git("rev-parse", "--abbrev-ref", "HEAD"), "25-slug");
        assert.equal(git("log", "-1", "--format=%s"), "Add carried.txt");
        assert.equal(fs.readFileSync(path.join(work, "loose.txt"), "utf8"), "loose\n");
        const [first] = calls(w.outbox);
        assert.match(first, /^resume --session s1 --message \S+\/resume\.md /);
        assert.ok(
            result(w.outbox).commits.some((/** @type {string} */ c) => /Add carried/.test(c))
        );
    });
    test("a second limit after discarding the edits and pushing the commits carries nothing", () => {
        const w = resumed(limited());
        const script = "rm loose.txt && git update-ref refs/remotes/origin/25-slug HEAD";
        runStage({...w.env, PIPELINE_RESUME_SESSION: "s1", FAKE_EXIT: "75", FAKE_SCRIPT: script});
        assert.equal(result(w.outbox).exit, 75);
        assert.equal(fs.existsSync(path.join(w.outbox, "carry.bundle")), false);
        assert.equal(fs.existsSync(path.join(w.outbox, "carry.patch")), false);
    });
    test("a second limit carries the tree as it is then, not the first carry", () => {
        const w = resumed(limited());
        const script = "rm loose.txt && echo fresh >fresh.txt";
        runStage({...w.env, PIPELINE_RESUME_SESSION: "s1", FAKE_EXIT: "75", FAKE_SCRIPT: script});
        const patch = fs.readFileSync(path.join(w.outbox, "carry.patch"), "utf8");
        assert.match(patch, /fresh\.txt/);
        assert.doesNotMatch(patch, /loose\.txt/);
        assert.ok(fs.statSync(path.join(w.outbox, "carry.bundle")).size > 0);
    });
    test("a patch that does not apply stops the session before the harness runs", () => {
        const w = resumed(limited());
        const patch = path.join(w.outbox, "carry.patch");
        fs.writeFileSync(
            patch,
            "--- a/no-such-file\n+++ b/no-such-file\n@@ -1 +1 @@\n-old\n+new\n"
        );
        runStage({...w.env, PIPELINE_RESUME_SESSION: "s1"});
        assert.equal(fs.existsSync(path.join(w.outbox, "calls")), false);
        assert.equal(result(w.outbox).carry, "failed");
        assert.notEqual(result(w.outbox).exit, 0);
        assert.match(fs.readFileSync(patch, "utf8"), /no-such-file/);
        assert.match(fs.readFileSync(path.join(w.outbox, "log"), "utf8"), /carry: patch failed/);
    });
    test("a bundle that does not restore stops the session before the harness runs", () => {
        const w = resumed(limited());
        fs.writeFileSync(path.join(w.outbox, "carry.bundle"), "not a bundle\n");
        runStage({...w.env, PIPELINE_RESUME_SESSION: "s1"});
        assert.equal(fs.existsSync(path.join(w.outbox, "calls")), false);
        assert.equal(result(w.outbox).carry, "failed");
        assert.ok(fs.existsSync(path.join(w.outbox, "carry.patch")));
    });
    test("a resume that fails with no tokens falls back to a run", () => {
        const w = resumed(limited());
        runStage({...w.env, PIPELINE_RESUME_SESSION: "s1", FAKE_RESUME_EXIT: "1"});
        const lines = calls(w.outbox);
        assert.equal(lines.length, 2);
        assert.match(lines[0], /^resume --session s1 /);
        assert.match(lines[1], /^run --prompt /);
        assert.equal(result(w.outbox).usage.status, "ok");
    });
});
