// test/pipeline/pipeline-run.test.js: how bin/pipeline.js opens, adopts and ends a run.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {emptyState} from "../../pipeline/lib/state.js";
import {main} from "../../bin/pipeline.js";
import {host, writeState, runningState} from "./pipeline-host.js";

const REPO = path.resolve(import.meta.dirname, "..", "..");

describe("bin/pipeline.js run", () => {
    test("--once waits for its sessions before it closes the mint", async () => {
        const h = host({statuses: ["running", "exited"]});
        const code = await main(["--once"], {root: h.root, env: {}, out: () => {}, deps: h.deps});
        assert.equal(code, 0);
        assert.deepEqual(h.events, ["remove", "close"]);
    });
    test("the digest finish carries the presenter of master and the Actions page", async () => {
        const h = host({statuses: []});
        const state = emptyState();
        state.run.started = "2026-10-21T19:00:00Z";
        state.run.notionPage = "page-1";
        fs.mkdirSync(path.join(h.root, "var", "pipeline"), {recursive: true});
        fs.writeFileSync(path.join(h.root, "var", "pipeline", "state.json"), JSON.stringify(state));
        /** @type {any[]} */
        const runs = [];
        h.deps.run = async (/** @type {string[]} */ cmd) => {
            runs.push(cmd);
            return cmd[0] === "git"
                ? {code: 0, stdout: "abc1234\n", stderr: ""}
                : {code: 1, stdout: "", stderr: ""};
        };
        /** @type {string[][]} */
        const argvs = [];
        h.deps.digest = async (/** @type {string[]} */ argv) => {
            argvs.push(argv);
            return 0;
        };
        const env = {NOTION_TOKEN: "nt", PIPELINE_EVIDENCE_URL: "https://ev.example/"};
        await main(["--digest"], {root: h.root, env, out: () => {}, deps: h.deps});
        const argv = argvs[0];
        assert.equal(argv[0], "finish");
        assert.equal(argv[argv.indexOf("--build") + 1], "https://github.com/tjlytle/Sozi/actions");
        assert.equal(
            argv[argv.indexOf("--presenter") + 1],
            "https://ev.example/builds/abc1234/presenter.html"
        );
        const mirror = path.join(h.root, "var", "pipeline", "mirror.git");
        assert.deepEqual(runs[0], ["git", "-C", mirror, "rev-parse", "master"]);
        argvs.length = 0;
        writeState(h.root, state);
        await main(["--digest"], {root: h.root, env: {NOTION_TOKEN: "nt"}, deps: h.deps});
        assert.ok(!argvs[0].includes("--presenter"), "no presenter without evidence");
        assert.ok(argvs[0].includes("--build"));
    });
    test("--until and --epic do not carry over to a restart", async () => {
        const h = host({statuses: ["exited"]});
        const state = emptyState();
        state.run.started = "2026-10-21T19:00:00Z";
        state.run.until = "2099-01-01T00:00:00Z";
        state.run.epic = 24;
        fs.mkdirSync(path.join(h.root, "var", "pipeline"), {recursive: true});
        const file = path.join(h.root, "var", "pipeline", "state.json");
        fs.writeFileSync(file, JSON.stringify(state));
        await main(["--once"], {root: h.root, env: {}, out: () => {}, deps: h.deps});
        const saved = JSON.parse(fs.readFileSync(file, "utf8"));
        assert.equal(saved.run.started, "2026-10-21T19:00:00Z", "the same run");
        assert.equal(saved.run.until, null);
        assert.equal(saved.run.epic, null);
        await main(["--once", "--epic", "24"], {
            root: h.root,
            env: {},
            out: () => {},
            deps: h.deps
        });
        assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).run.epic, 24);
    });
    test("a digest ends the run; the next start opens a new one", async () => {
        const h = host({statuses: []});
        const file = writeState(h.root, runningState());
        /** @type {string[][]} */
        const argvs = [];
        h.deps.digest = async (/** @type {string[]} */ argv, /** @type {any} */ io) => {
            argvs.push(argv);
            io.out?.("page-2\n");
            return 0;
        };
        const env = {NOTION_TOKEN: "nt", PIPELINE_NOTION_PARENT: "parent"};
        await main(["--digest"], {root: h.root, env, out: () => {}, deps: h.deps});
        assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).run.stopped, true);
        await main(["--once"], {root: h.root, env, out: () => {}, deps: h.deps});
        assert.deepEqual(
            argvs.map(a => a[0]),
            ["finish", "start"]
        );
        const run = JSON.parse(fs.readFileSync(file, "utf8")).run;
        assert.equal(run.notionPage, "page-2");
        assert.notEqual(run.started, "2026-10-21T19:00:00Z");
        assert.equal(run.stopped, false);
        assert.equal(run.tokens, 0);
        assert.equal(run.costUsd, 0);
        let text = "";
        await main(["--status"], {root: h.root, env: {}, out: t => (text += t), deps: h.deps});
        assert.ok(text.includes(`run: started ${run.started}\n`));
        assert.match(text, /totals: 0 tokens, \$0\.00/);
    });
    test("a restart without a digest adopts the run and its live session", async () => {
        const h = host({statuses: ["running", "exited"]});
        const state = runningState();
        const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "ob-"));
        state.run.sessions = [{container: "s1", started: "t", outbox, persona: "ops", issue: 9}];
        const file = writeState(h.root, state);
        /** @type {string[]} */
        const keys = [];
        h.deps.startMint = async (/** @type {any} */ o) => {
            keys.push(o.key);
            return {url: "u", port: 7311, close: async () => {}};
        };
        await main(["--once"], {root: h.root, env: {}, out: () => {}, deps: h.deps});
        const run = JSON.parse(fs.readFileSync(file, "utf8")).run;
        assert.equal(run.started, "2026-10-21T19:00:00Z");
        assert.equal(run.notionPage, "page-1");
        assert.equal(run.tokens, 1234);
        assert.equal(run.costUsd, 5);
        assert.deepEqual(keys, ["old-key"]);
    });
    test("a digest that could not post leaves the run open", async () => {
        const h = host({statuses: []});
        const file = writeState(h.root, runningState());
        h.deps.digest = async () => 1;
        const env = {NOTION_TOKEN: "nt"};
        await main(["--digest"], {root: h.root, env, out: () => {}, deps: h.deps});
        const run = JSON.parse(fs.readFileSync(file, "utf8")).run;
        assert.equal(run.stopped, false);
        assert.equal(run.notionPage, "page-1");
    });
    test("a digest without NOTION_TOKEN leaves the run open", async () => {
        const h = host({statuses: []});
        const file = writeState(h.root, runningState());
        h.deps.digest = async () => 0;
        await main(["--digest"], {root: h.root, env: {}, out: () => {}, deps: h.deps});
        const run = JSON.parse(fs.readFileSync(file, "utf8")).run;
        assert.equal(run.stopped, false);
        assert.equal(run.notionPage, "page-1");
    });
    test("a second digest on a finished run posts nothing", async () => {
        const h = host({statuses: []});
        const state = runningState();
        state.run.stopped = true;
        writeState(h.root, state);
        let calls = 0;
        h.deps.digest = async () => {
            calls++;
            return 0;
        };
        let text = "";
        await main(["--digest"], {
            root: h.root,
            env: {NOTION_TOKEN: "nt"},
            out: t => (text += t),
            deps: h.deps
        });
        assert.equal(calls, 0);
        assert.match(text, /digest: this run is already finished/);
    });
    test("a finished run hands its live sessions, spawns and mint key to the next", async () => {
        const h = host({statuses: []});
        const state = runningState();
        state.run.stopped = true;
        const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "ob-"));
        state.run.sessions = [{container: "s1", started: "t", outbox, persona: "ops", issue: 9}];
        state.run.spawns = [{persona: "advocate", prompt: "p", issue: 9, harness: null}];
        writeState(h.root, state);
        /** @type {string[]} */
        const keys = [];
        h.deps.startMint = async (/** @type {any} */ o) => {
            keys.push(o.key);
            return {url: "u", port: 7311, close: async () => {}};
        };
        /** @type {string[]} */
        const asked = [];
        h.deps.sandbox.status = async (/** @type {string} */ container) => {
            asked.push(container);
            return "exited";
        };
        /** @type {string[]} */
        const started = [];
        h.deps.sandbox.start = async (/** @type {any} */ o) => {
            started.push(o.persona ?? "issue");
            return "c";
        };
        const spawnPrompt = path.join("pipeline", "spawn.md");
        fs.copyFileSync(path.join(REPO, spawnPrompt), path.join(h.root, spawnPrompt));
        await main(["--once"], {root: h.root, env: {}, out: () => {}, deps: h.deps});
        assert.deepEqual(keys, ["old-key"]);
        assert.ok(asked.includes("s1"), "the spawn session is still watched");
        assert.ok(started.includes("advocate"), "the queued spawn still starts");
    });
    test("one interrupt keeps the mint up until the last session is judged", async () => {
        const h = host({
            statuses: ["running", "running", "exited"],
            onSleep: n => {
                h.events.push(`sleep ${n}`);
                if (n === 1) {
                    h.handler("SIGTERM");
                }
            }
        });
        const code = await main([], {root: h.root, env: {}, out: () => {}, deps: h.deps});
        assert.equal(code, 0);
        assert.deepEqual(h.exits, []);
        assert.deepEqual(h.events, ["sleep 1", "sleep 2", "sleep 3", "sleep 4", "remove", "close"]);
    });
    test("a second interrupt after a second leaves the session in the state", async () => {
        let t = 0;
        const h = host({
            statuses: ["running", "running", "running"],
            onSleep: n => {
                t += 1500;
                if (n <= 2) {
                    h.handler("SIGINT");
                }
            }
        });
        h.deps.now = () => t;
        h.deps.exit = (/** @type {number} */ code) => {
            h.exits.push(code);
            throw new Error("exit");
        };
        await assert.rejects(
            main([], {root: h.root, env: {}, out: () => {}, deps: h.deps}),
            /exit/
        );
        assert.deepEqual(h.exits, [130]);
        const saved = JSON.parse(
            fs.readFileSync(path.join(h.root, "var", "pipeline", "state.json"), "utf8")
        );
        assert.equal(saved.issues[25].session.container, "c25", "the next start adopts it");
    });
    test("Ctrl-C stops the watch after the pass; a second one leaves at once", async () => {
        let t = 0;
        const h = host({
            statuses: ["running", "running", "exited"],
            onSleep: n => {
                t += 1500;
                if (n <= 2) {
                    h.handler();
                }
            }
        });
        h.deps.now = () => t;
        const code = await main([], {root: h.root, env: {}, out: () => {}, deps: h.deps});
        assert.equal(code, 0);
        assert.deepEqual(h.exits, [130]);
        const saved = JSON.parse(
            fs.readFileSync(path.join(h.root, "var", "pipeline", "state.json"), "utf8")
        );
        assert.equal(saved.run.stopped, false, "an interrupted run goes on at the next start");
    });
});
