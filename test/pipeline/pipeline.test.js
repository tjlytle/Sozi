// test/pipeline/pipeline.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {emptyState, applyIssue} from "../../pipeline/lib/state.js";
import {main} from "../../bin/pipeline.js";
import {host, issue} from "./pipeline-host.js";

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
                codex: {present: true, loggedIn: true},
                agy: {present: true, loggedIn: true},
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
        assert.match(text, /profile builder: claude logged in; codex logged in; agy logged in\n/);
        assert.match(text, /profile qa: claude not logged in\n/);
        assert.match(text, /profile ops: none\n/);
        assert.match(text, /profile advocate: unknown \(docker is down\)\n/);
        assert.doesNotMatch(text, /accessToken|s3cret/);
    });
    test("--on-limit sets PIPELINE_ON_LIMIT for the run and rejects anything else", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-"));
        let text = "";
        const bad = await main(["--status", "--on-limit", "maybe"], {
            root,
            env: {},
            err: t => (text += t)
        });
        assert.equal(bad, 2);
        assert.match(text, /PIPELINE_ON_LIMIT must be one of wait\|fallback, not "maybe"/);
        assert.match(text, /--on-limit wait\|fallback/);
        const good = await main(["--status", "--on-limit", "fallback"], {
            root,
            env: {},
            out: () => {}
        });
        assert.equal(good, 0);
    });
    test("an unknown argument prints the usage", async () => {
        let text = "";
        assert.equal(await main(["nope"], {env: {}, err: t => (text += t)}), 2);
        assert.match(text, /usage/);
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
    assert.match(text, /harness must be one of claude\|codex\|agy\|opencode/);
});

test("--copy-profile copies one persona to another without a mint or state", async () => {
    const h = host({statuses: []});
    /** @type {any} */
    let got;
    h.deps.sandbox.copyProfile = async (/** @type {any} */ opts) => {
        got = opts;
    };
    let text = "";
    assert.equal(
        await main(["--copy-profile", "builder", "qa"], {
            root: h.root,
            env: {},
            out: t => (text += t),
            deps: h.deps
        }),
        0
    );
    assert.deepEqual(got, {from: "builder", to: "qa"});
    assert.equal(
        text,
        "copied builder to qa without the Claude login: run npm run pipeline -- --login qa once\n"
    );
    assert.ok(!h.events.includes("close"), "no mint was opened");
    assert.ok(!fs.existsSync(path.join(h.root, "var")), "no state file was written");
});

test("--build-image builds the image through the sandbox and returns 0 without a state or mint", async () => {
    const h = host({statuses: []});
    let builds = 0;
    let mints = 0;
    h.deps.sandbox.buildImage = async () => void builds++;
    h.deps.startMint = async () => {
        mints++;
        throw new Error("no mint for --build-image");
    };
    assert.equal(await main(["--build-image"], {root: h.root, env: {}, deps: h.deps}), 0);
    assert.equal(builds, 1);
    assert.equal(mints, 0, "no mint was started");
    assert.ok(!fs.existsSync(path.join(h.root, "var")), "no state file was written");
});

test("--copy-profile writes no hint when the copy fails", async () => {
    const h = host({statuses: []});
    h.deps.sandbox.copyProfile = async () => {
        throw new Error("profile of qa exists; remove the volume first");
    };
    let text = "";
    let errText = "";
    assert.equal(
        await main(["--copy-profile", "builder", "qa"], {
            root: h.root,
            env: {},
            out: t => (text += t),
            err: t => (errText += t),
            deps: h.deps
        }),
        1
    );
    assert.equal(text, "");
    assert.equal(errText, "profile of qa exists; remove the volume first\n");
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
