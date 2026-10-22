// test/pipeline/pipeline.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {emptyState, applyIssue} from "../../pipeline/lib/state.js";
import {main} from "../../bin/pipeline.js";

const REPO = path.resolve(import.meta.dirname, "..", "..");

/**
 * A repository root with the prompts, and fakes for everything outside the loop.
 *
 * @param {{statuses: string[], onSleep?: (calls: number) => void}} options - The container
 *     states the fake docker reports in turn, and a hook on each wait.
 * @returns {any} - The root, the recorded events, the fakes and the captured handler.
 */
function host({statuses, onSleep = () => {}}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-"));
    fs.mkdirSync(path.join(root, "pipeline"));
    for (const f of ["plan.md", "allow.txt"]) {
        fs.copyFileSync(path.join(REPO, "pipeline", f), path.join(root, "pipeline", f));
    }
    /** @type {string[]} */
    const events = [];
    const h = {root, events, handler: () => {}, exits: /** @type {number[]} */ ([])};
    let sleeps = 0;
    const issues = [{...issue(25, ["stage:todo"])}];
    const silent = async () => {};
    h.deps = {
        run: async () => ({code: 1, stdout: "", stderr: ""}),
        startMint: async () => ({
            url: "u",
            port: 7311,
            close: async () => void events.push("close")
        }),
        github: {
            searchIssues: async () => issues,
            labelsOf: async () => ["stage:todo"],
            label: silent,
            comment: silent,
            planComment: async () => null,
            lastCommentIsHuman: async () => false,
            lastHumanCommentAt: async () => null,
            openPrFor: async () => null
        },
        board: {sync: silent},
        sandbox: {
            refreshMirror: silent,
            prepareOutbox: () => fs.mkdtempSync(path.join(os.tmpdir(), "ob-")),
            start: async () => "c25",
            status: async () => statuses.shift() ?? "exited",
            stop: silent,
            remove: async () => void events.push("remove")
        },
        sleep: async () => onSleep(++sleeps),
        onSignal: (/** @type {() => void} */ handler) => {
            h.handler = handler;
            return () => {};
        },
        exit: (/** @type {number} */ code) => void h.exits.push(code)
    };
    return h;
}

const issue = (/** @type {number} */ number, /** @type {string[]} */ labels) => ({
    number,
    title: `t${number}`,
    labels,
    state: /** @type {"OPEN"} */ ("OPEN"),
    body: "",
    updatedAt: "2026-10-21T00:00:00Z"
});

describe("bin/pipeline.js", () => {
    test("--status reads the state file and prints sessions and queues", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-"));
        const state = emptyState();
        applyIssue(state, issue(25, ["stage:in-progress"]));
        state.issues[25].session = {container: "c25", started: "t", stage: "build", outbox: "o"};
        state.queued.push({issue: 25, add: ["stage:review"], remove: []});
        state.queued.push({comment: {persona: "ops", issue: 25, body: "b"}});
        state.deadLetters = [{op: {issue: 99, add: ["triage"], remove: []}, error: "HTTP 404"}];
        fs.mkdirSync(path.join(root, "var", "pipeline"), {recursive: true});
        fs.writeFileSync(path.join(root, "var", "pipeline", "state.json"), JSON.stringify(state));
        let text = "";
        const code = await main(["--status"], {root, env: {}, out: t => (text += t)});
        assert.equal(code, 0);
        assert.match(text, /#25 build: c25/);
        assert.match(text, /queued labels: 2/);
        assert.match(text, /#25 comment as ops/);
        assert.match(text, /dead letters: 1\n.*HTTP 404/);
    });
    test("an unknown argument prints the usage", async () => {
        let text = "";
        assert.equal(await main(["nope"], {env: {}, err: t => (text += t)}), 2);
        assert.match(text, /usage/);
    });
    test("--once waits for its sessions before it closes the mint", async () => {
        const h = host({statuses: ["running", "exited"]});
        const code = await main(["--once"], {root: h.root, env: {}, out: () => {}, deps: h.deps});
        assert.equal(code, 0);
        assert.deepEqual(h.events, ["remove", "close"]);
    });
    test("secrets in var/pipeline/env reach docker run and the Notion start", async () => {
        const h = host({statuses: []});
        fs.mkdirSync(path.join(h.root, "var", "pipeline"), {recursive: true});
        fs.writeFileSync(
            path.join(h.root, "var", "pipeline", "env"),
            "CLAUDE_CODE_OAUTH_TOKEN=tok\nNOTION_TOKEN=nt\n"
        );
        /** @type {any[]} */
        const runs = [];
        delete h.deps.sandbox;
        h.deps.run = async (/** @type {string[]} */ cmd, /** @type {any} */ opts) => {
            runs.push({cmd, opts});
            if (cmd[0] === "docker" && cmd[1] === "run") {
                return {code: 0, stdout: "c25\n", stderr: ""};
            }
            if (cmd[0] === "docker" && cmd[1] === "inspect") {
                return {code: 0, stdout: "exited\n", stderr: ""};
            }
            return {code: 1, stdout: "", stderr: ""};
        };
        /** @type {any[]} */
        const digests = [];
        h.deps.digest = async (/** @type {string[]} */ argv, /** @type {any} */ io) => {
            digests.push({argv, env: io.env});
            io.out?.("page-1\n");
            return 0;
        };
        const code = await main(["--once"], {
            root: h.root,
            env: {PIPELINE_NOTION_PARENT: "parent"},
            out: () => {},
            deps: h.deps
        });
        assert.equal(code, 0);
        const docker = runs.find(r => r.cmd[0] === "docker" && r.cmd[1] === "run");
        assert.equal(docker.opts.env.CLAUDE_CODE_OAUTH_TOKEN, "tok");
        assert.equal(digests[0].argv[0], "start");
        assert.equal(digests[0].env.NOTION_TOKEN, "nt");
    });
    test("Ctrl-C stops the watch after the pass; a second one leaves at once", async () => {
        const h = host({
            statuses: ["running", "running", "exited"],
            onSleep: n => {
                if (n <= 2) {
                    h.handler();
                }
            }
        });
        const code = await main([], {root: h.root, env: {}, out: () => {}, deps: h.deps});
        assert.equal(code, 0);
        assert.deepEqual(h.exits, [130]);
        const saved = JSON.parse(
            fs.readFileSync(path.join(h.root, "var", "pipeline", "state.json"), "utf8")
        );
        assert.equal(saved.run.stopped, false, "an interrupted run goes on at the next start");
    });
});
