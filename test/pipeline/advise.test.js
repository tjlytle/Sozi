// test/pipeline/advise.test.js: bin/advise against a temporary outbox and a scratch checkout.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawn} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {root} from "./harness-adapter.js";

const ADVISE = path.join(root, "bin/advise");

/**
 * A scratch checkout with a commit on master, origin/master pointing at it, and an outbox.
 *
 * @returns {{work: string, outbox: string}} The checkout and the outbox.
 */
function scratch() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "advise-"));
    const work = path.join(dir, "work");
    const outbox = path.join(dir, "outbox");
    fs.mkdirSync(work);
    fs.mkdirSync(outbox);
    const git = (/** @type {string[]} */ ...args) =>
        execFileSync("git", ["-C", work, ...args], {stdio: "ignore"});
    git("init", "-q", "-b", "master");
    fs.writeFileSync(path.join(work, "a.txt"), "one\n");
    git("add", "a.txt");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "one");
    git("update-ref", "refs/remotes/origin/master", "HEAD");
    return {work, outbox};
}

/**
 * Run bin/advise with only PATH, the outbox and the advise settings in its environment: no
 * harness, as from a Codex stage. Each question it writes gets the answer given, if any.
 *
 * @param {{work: string, outbox: string}} where - The checkout and the outbox.
 * @param {string[]} args - The arguments.
 * @param {{answer?: any, env?: Record<string, string>}} [options] - The answer to write, and more environment.
 * @returns {Promise<{code: number | null, stdout: string, stderr: string, question: any}>} How it ended and the question it wrote.
 */
function advise({work, outbox}, args, {answer, env = {}} = {}) {
    return new Promise(resolve => {
        const child = spawn("bash", [ADVISE, ...args], {
            cwd: work,
            env: {
                PATH: process.env.PATH ?? "",
                OUTBOX: outbox,
                PIPELINE_ISSUE: "7",
                PIPELINE_STAGE: "build",
                PIPELINE_ADVISOR_POLL_SECONDS: "0.05",
                ...env
            }
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", d => (stdout += d));
        child.stderr.on("data", d => (stderr += d));
        /** @type {any} */
        let question = null;
        const timer = setInterval(() => {
            const dir = path.join(outbox, "advise");
            const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
            const q = names.find(n => /^q-\d+\.json$/.test(n));
            if (q && question === null) {
                question = JSON.parse(fs.readFileSync(path.join(dir, q), "utf8"));
                if (answer) {
                    const a = q.replace(/^q-/, "a-");
                    fs.writeFileSync(path.join(dir, a), JSON.stringify(answer));
                }
            }
        }, 20);
        child.on("close", code => {
            clearInterval(timer);
            resolve({code, stdout, stderr, question});
        });
    });
}

describe("bin/advise", () => {
    test("writes the question and prints the advice", async () => {
        const s = scratch();
        fs.writeFileSync(path.join(s.work, "a.txt"), "two\n");
        const r = await advise(s, ["Why does it fail?"], {answer: {advice: "Do X."}});
        assert.equal(r.code, 0, r.stderr);
        assert.equal(r.stdout.trim(), "Do X.");
        assert.equal(r.question.question, "Why does it fail?");
        assert.equal(r.question.stage, "build");
        assert.equal(r.question.issue, 7);
        assert.match(r.question.diff, /-one\n\+two/);
        assert.equal(r.question.failing, "");
    });

    test("prints the refusal and exits 1", async () => {
        const s = scratch();
        const refused = "advisor limit reached: 2 consults a session (PIPELINE_ADVISOR_MAX)";
        const r = await advise(s, ["q"], {answer: {refused}});
        assert.equal(r.code, 1);
        assert.match(r.stdout + r.stderr, /advisor limit reached: 2 consults a session/);
    });

    test("prints an advisor failure and exits 1", async () => {
        const s = scratch();
        const r = await advise(s, ["q"], {answer: {error: "advisor failed: no answer"}});
        assert.equal(r.code, 1);
        assert.match(r.stderr, /advisor failed: no answer/);
    });

    test("exits 2 when no answer comes in time", async () => {
        const s = scratch();
        const r = await advise(s, ["q"], {env: {PIPELINE_ADVISOR_WAIT_MINUTES: "0.01"}});
        assert.equal(r.code, 2);
        assert.match(r.stderr, /no answer in time/);
    });

    test("numbers a question after the ones already asked", async () => {
        const s = scratch();
        fs.mkdirSync(path.join(s.outbox, "advise"));
        fs.writeFileSync(path.join(s.outbox, "advise", "q-1.json"), "{}");
        fs.writeFileSync(
            path.join(s.outbox, "advise", "a-1.json"),
            JSON.stringify({advice: "old"})
        );
        const r = await advise(s, ["q"], {env: {PIPELINE_ADVISOR_WAIT_MINUTES: "0.01"}});
        assert.equal(r.code, 2);
        assert.ok(fs.existsSync(path.join(s.outbox, "advise", "q-2.json")));
    });

    test("cuts a large diff to 100 KiB and the failing output to 20 KiB", async () => {
        const s = scratch();
        fs.writeFileSync(path.join(s.work, "a.txt"), "x".repeat(200 * 1024) + "\n");
        const failing = path.join(s.outbox, "..", "failing.txt");
        fs.writeFileSync(failing, "f".repeat(50 * 1024));
        const r = await advise(s, ["q", "--output", failing], {answer: {advice: "ok"}});
        assert.equal(r.code, 0, r.stderr);
        assert.match(r.question.diff, /\[diff cut to 100 KiB\]$/);
        assert.ok(Buffer.byteLength(r.question.diff) < 101 * 1024);
        assert.match(r.question.failing, /\[failing output cut to 20 KiB\]$/);
        assert.ok(Buffer.byteLength(r.question.failing) < 21 * 1024);
    });

    test("without a question prints the usage and exits 64", async () => {
        const s = scratch();
        const r = await advise(s, []);
        assert.equal(r.code, 64);
        assert.match(r.stderr, /usage: bin\/advise/i);
    });
});
