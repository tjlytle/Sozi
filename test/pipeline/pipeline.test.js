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
            remove: async () => void events.push("remove"),
            inspectProfile: async () => ({
                claude: {present: true, loggedIn: true, servers: []},
                codex: {present: false, loggedIn: false},
                writable: true
            })
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

/**
 * Write a state file under a root.
 *
 * @param {string} root - The repository root.
 * @param {any} state - The state.
 * @returns {string} - The state file.
 */
function writeState(root, state) {
    fs.mkdirSync(path.join(root, "var", "pipeline"), {recursive: true});
    const file = path.join(root, "var", "pipeline", "state.json");
    fs.writeFileSync(file, JSON.stringify(state));
    return file;
}

/**
 * A run in progress: started, with a page, totals and a mint key.
 *
 * @returns {any} - The state.
 */
function runningState() {
    const state = emptyState();
    state.run.started = "2026-10-21T19:00:00Z";
    state.run.notionPage = "page-1";
    state.run.tokens = 1234;
    state.run.costUsd = 5;
    state.run.mintKey = "old-key";
    return state;
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
    test("--status lists each persona profile without values", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-"));
        fs.mkdirSync(path.join(root, "var", "pipeline"), {recursive: true});
        fs.writeFileSync(
            path.join(root, "var", "pipeline", "state.json"),
            JSON.stringify(emptyState())
        );
        /** @type {Record<string, any>} */
        const infos = {
            architect: {
                claude: {present: true, loggedIn: true, servers: ["mobbin"], accessToken: "s3cret"},
                codex: {present: false, loggedIn: false},
                writable: true
            },
            builder: {
                claude: {present: true, loggedIn: true, servers: []},
                codex: {present: false, loggedIn: false},
                writable: true
            },
            qa: {
                claude: {present: true, loggedIn: false, servers: []},
                codex: {present: false, loggedIn: false},
                writable: true
            },
            reviewer: null
        };
        const sandbox = {
            inspectProfile: async (/** @type {string} */ persona) => {
                if (persona === "advocate") {
                    throw new Error("docker is down\nsecond line");
                }
                return infos[persona] ?? null;
            }
        };
        let text = "";
        const code = await main(["--status"], {
            root,
            env: {},
            out: t => (text += t),
            deps: /** @type {any} */ ({sandbox})
        });
        assert.equal(code, 0);
        assert.match(text, /profile architect: claude logged in, servers: mobbin\n/);
        assert.match(text, /profile builder: claude logged in\n/);
        assert.match(text, /profile qa: claude not logged in\n/);
        assert.match(text, /profile ops: none\n/);
        assert.match(text, /profile advocate: unknown \(docker is down\)\n/);
        assert.doesNotMatch(text, /accessToken|s3cret/);
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

test("--login runs the interactive login for a persona and returns its status", async () => {
    const h = host({statuses: []});
    /** @type {any} */
    let got;
    h.deps.sandbox.login = async (/** @type {any} */ opts) => {
        got = opts;
        return 0;
    };
    assert.equal(
        await main(["--login", "architect"], {
            root: h.root,
            env: {},
            out: () => {},
            deps: h.deps
        }),
        0
    );
    assert.deepEqual(got, {persona: "architect", harness: "claude"});
    assert.ok(!h.events.includes("close"), "no mint was opened");
    assert.ok(!fs.existsSync(path.join(h.root, "var")), "no state file was written");
});

test("--login rejects an unknown persona or harness with the usage", async () => {
    let text = "";
    assert.equal(await main(["--login", "root"], {env: {}, err: t => (text += t)}), 2);
    assert.match(text, /persona must be one of advocate\|architect\|builder\|qa\|reviewer\|ops/);
    assert.match(text, /--login <persona>/);
    text = "";
    assert.equal(
        await main(["--login", "qa", "--harness", "cursor"], {env: {}, err: t => (text += t)}),
        2
    );
    assert.match(text, /harness must be one of claude\|codex\|opencode/);
});

test("--copy-profile copies one persona to another without a mint or state", async () => {
    const h = host({statuses: []});
    /** @type {any} */
    let got;
    h.deps.sandbox.copyProfile = async (/** @type {any} */ opts) => {
        got = opts;
    };
    assert.equal(
        await main(["--copy-profile", "builder", "qa"], {
            root: h.root,
            env: {},
            out: () => {},
            deps: h.deps
        }),
        0
    );
    assert.deepEqual(got, {from: "builder", to: "qa"});
    assert.ok(!h.events.includes("close"), "no mint was opened");
    assert.ok(!fs.existsSync(path.join(h.root, "var")), "no state file was written");
});

test("--copy-profile rejects an unknown persona with the usage", async () => {
    let text = "";
    assert.equal(
        await main(["--copy-profile", "builder", "root"], {env: {}, err: t => (text += t)}),
        2
    );
    assert.match(text, /persona must be one of/);
    assert.equal(await main(["--copy-profile", "builder"], {env: {}, err: () => {}}), 2);
});
