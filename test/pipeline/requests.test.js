/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {validateRequest, readRequests, readResult} from "../../pipeline/lib/requests.js";

/**
 * Make a scratch directory.
 * @returns {string} The directory path.
 */
function scratch() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "requests-test-"));
}

describe("outbox requests", () => {
    test("done moves this issue to a stage", () => {
        assert.deepEqual(validateRequest({done: {issue: 25, to: "stage:review"}}, {issue: 25}), {
            kind: "done",
            issue: 25,
            to: "stage:review"
        });
    });
    test("done for another issue is refused", () => {
        assert.throws(
            () => validateRequest({done: {issue: 26, to: "stage:review"}}, {issue: 25}),
            /issue 26/
        );
    });
    test("label never adds stage:done or working", () => {
        assert.throws(
            () => validateRequest({label: {issue: 25, add: ["stage:done"]}}, {issue: 25}),
            /stage:done/
        );
        assert.throws(
            () => validateRequest({label: {issue: 25, add: ["working"]}}, {issue: 25}),
            /working/
        );
        assert.equal(
            validateRequest({label: {issue: 30, add: ["triage"]}}, {issue: 25}).kind,
            "label"
        );
    });
    test("spawn needs a persona and a prompt", () => {
        assert.throws(() => validateRequest({spawn: {prompt: "x"}}, {issue: 25}), /persona/);
        assert.throws(
            () =>
                validateRequest(
                    {spawn: {persona: "advocate", prompt: "x", harness: "gemini"}},
                    {issue: 25}
                ),
            /harness/
        );
        assert.equal(
            /** @type {import("../../pipeline/lib/requests.js").SpawnRequest} */ (
                validateRequest({spawn: {persona: "advocate", prompt: "file it"}}, {issue: 25})
            ).persona,
            "advocate"
        );
    });
    test("unknown kinds are refused", () => {
        assert.throws(() => validateRequest({merge: {}}, {issue: 25}), /unknown/);
    });
});

describe("outbox request details", () => {
    test("done refuses a stage outside the list", () => {
        assert.throws(
            () => validateRequest({done: {issue: 25, to: "stage:todo"}}, {issue: 25}),
            /stage:todo/
        );
    });
    test("label fills missing arrays and refuses removing working or unknown labels", () => {
        assert.deepEqual(validateRequest({label: {issue: 25, remove: ["idea"]}}, {issue: 25}), {
            kind: "label",
            issue: 25,
            add: [],
            remove: ["idea"]
        });
        assert.throws(
            () => validateRequest({label: {issue: 25, remove: ["working"]}}, {issue: 25}),
            /working/
        );
        assert.throws(
            () => validateRequest({label: {issue: 25, add: ["bug"]}}, {issue: 25}),
            /bug/
        );
    });
    test("spawn needs a non-empty prompt and keeps optional fields", () => {
        assert.throws(
            () => validateRequest({spawn: {persona: "qa", prompt: "  "}}, {issue: 25}),
            /prompt/
        );
        assert.deepEqual(
            validateRequest(
                {spawn: {persona: "qa", prompt: "go", issue: 7, harness: "codex"}},
                {issue: 25}
            ),
            {
                kind: "spawn",
                persona: "qa",
                prompt: "go",
                issue: 7,
                harness: "codex"
            }
        );
    });
    test("note needs text", () => {
        assert.deepEqual(validateRequest({note: "hello"}, {issue: 25}), {
            kind: "note",
            text: "hello"
        });
        assert.throws(() => validateRequest({note: ""}, {issue: 25}), /note/);
    });
    test("non-objects are refused", () => {
        assert.throws(() => validateRequest([], {issue: 25}), /object/);
        assert.throws(() => validateRequest(null, {issue: 25}), /object/);
    });
});

describe("readRequests", () => {
    test("reads in name order and sorts accepted from refused", () => {
        const dir = scratch();
        fs.writeFileSync(path.join(dir, "req-2.json"), "{nope");
        fs.writeFileSync(path.join(dir, "req-1.json"), JSON.stringify({note: "hi"}));
        fs.writeFileSync(
            path.join(dir, "req-3.json"),
            JSON.stringify({note: "a", done: {issue: 25, to: "stage:qa"}})
        );
        fs.writeFileSync(path.join(dir, "other.json"), JSON.stringify({note: "ignored"}));
        const {accepted, refused} = readRequests(dir, {issue: 25});
        assert.deepEqual(accepted, [{kind: "note", text: "hi"}]);
        assert.equal(refused.length, 2);
        assert.deepEqual(refused[0], {file: "req-2.json", reason: "not JSON"});
        assert.equal(refused[1].file, "req-3.json");
        assert.match(refused[1].reason, /one request per file/);
    });
    test("a missing directory gives nothing", () => {
        assert.deepEqual(readRequests(path.join(scratch(), "none"), {issue: 1}), {
            accepted: [],
            refused: []
        });
    });
});

describe("readResult", () => {
    test("missing or malformed file gives null", () => {
        const dir = scratch();
        assert.equal(readResult(dir), null);
        fs.writeFileSync(path.join(dir, "result.json"), "{bad");
        assert.equal(readResult(dir), null);
    });
    test("a partial object gets defaults", () => {
        const dir = scratch();
        fs.writeFileSync(
            path.join(dir, "result.json"),
            JSON.stringify({exit: 0, usage: {turns: 4}, changed: ["a"]})
        );
        assert.deepEqual(readResult(dir), {
            exit: 0,
            session: null,
            usage: {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 4, status: "error"},
            changed: ["a"],
            commits: [],
            resumes: 0,
            hooks: "ok"
        });
    });
});

describe("hostile input", () => {
    const session = {issue: 25};
    test("types are checked", () => {
        assert.throws(
            () => validateRequest({done: {issue: "25", to: "stage:qa"}}, session),
            /issue/
        );
        assert.throws(() => validateRequest({done: {issue: 25, to: 5}}, session), /done target/);
        assert.throws(
            () => validateRequest({label: {issue: 25, add: "triage"}}, session),
            /list of labels/
        );
        assert.throws(() => validateRequest(JSON.parse('{"__proto__": {}}'), session), /unknown/);
        assert.throws(() => validateRequest({label: {issue: 1.5, add: []}}, session), /issue/);
        assert.throws(() => validateRequest({label: {issue: 0, add: []}}, session), /issue/);
        assert.throws(() => validateRequest({label: {issue: 2 ** 60, add: []}}, session), /issue/);
        assert.throws(
            () => validateRequest({spawn: {persona: "qa", prompt: "x", issue: 1.5}}, session),
            /issue/
        );
        assert.throws(
            () => validateRequest({spawn: {persona: "qa", prompt: "x", issue: -3}}, session),
            /issue/
        );
    });
    test("a done for another issue is refused through readRequests", () => {
        const dir = scratch();
        fs.writeFileSync(
            path.join(dir, "req-1.json"),
            JSON.stringify({done: {issue: 26, to: "stage:qa"}})
        );
        const {accepted, refused} = readRequests(dir, session);
        assert.deepEqual(accepted, []);
        assert.equal(refused[0].file, "req-1.json");
        assert.match(refused[0].reason, /issue 26/);
    });
    test("request files sort numerically", () => {
        const dir = scratch();
        for (const n of [10, 2, 1]) {
            fs.writeFileSync(path.join(dir, `req-${n}.json`), JSON.stringify({note: `n${n}`}));
        }
        assert.deepEqual(
            readRequests(dir, session).accepted.map(r => (r.kind === "note" ? r.text : "")),
            ["n1", "n2", "n10"]
        );
    });
    test("readResult checks every field type and drops unknown keys", () => {
        const dir = scratch();
        fs.writeFileSync(
            path.join(dir, "result.json"),
            JSON.stringify({
                exit: "0",
                session: 7,
                extra: "x",
                usage: {tokensIn: "x", tokensOut: 5, costUsd: null, turns: 2, status: "weird"},
                changed: ["a", 3, "b"],
                commits: "abc",
                resumes: -1
            })
        );
        assert.deepEqual(readResult(dir), {
            exit: 1,
            session: null,
            usage: {tokensIn: 0, tokensOut: 5, costUsd: 0, turns: 2, status: "error"},
            changed: ["a", "b"],
            commits: [],
            resumes: 0,
            hooks: "ok"
        });
        fs.writeFileSync(
            path.join(dir, "result.json"),
            JSON.stringify({usage: "lots", exit: 0, resumes: 2})
        );
        const result = readResult(dir);
        assert.equal(result?.usage.turns, 0);
        assert.equal(result?.exit, 0);
        assert.equal(result?.resumes, 2);
        assert.equal(result?.hooks, "ok");
    });
    test("readResult keeps a crashed outside pass and defaults anything else to ok", () => {
        const dir = scratch();
        fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({exit: 0, hooks: "error"}));
        assert.equal(readResult(dir)?.hooks, "error");
        fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({exit: 0, hooks: 5}));
        assert.equal(readResult(dir)?.hooks, "ok");
    });
});
