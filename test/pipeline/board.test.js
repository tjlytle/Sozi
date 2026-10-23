import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {LABELS, stageToColumn, columnToStage, decide, main, sync} from "../../bin/board.js";
import {emptyState, applyIssue, dueIssues} from "../../pipeline/lib/state.js";

/**
 * A fake runner that replays canned replies by command prefix and records every command.
 * @param {Record<string, string | {code: number, stderr: string}>} replies - Joined command prefix to stdout, or a failure.
 * @param {(cmd: string[]) => void} [hook] - Called with each command before it is answered.
 * @returns {{run: (cmd: string[]) => Promise<any>, calls: string[][]}} - The runner and its log.
 */
function fake(replies, hook) {
    /** @type {string[][]} */
    const calls = [];
    return {
        calls,
        async run(cmd) {
            calls.push(cmd);
            hook?.(cmd);
            const line = cmd.join(" ");
            const key = Object.keys(replies)
                .sort((a, b) => b.length - a.length)
                .find(k => line.startsWith(k));
            const reply = key === undefined ? "" : replies[key];
            return typeof reply === "string"
                ? {code: 0, stdout: reply, stderr: ""}
                : {code: reply.code, stdout: "", stderr: reply.stderr};
        }
    };
}

const REPO = "tjlytle/Sozi";
const PROJECT = JSON.stringify({projects: [{title: "Sozi pipeline", number: 3, id: "P1"}]});
const NAMES = [
    "Triage",
    "Ideas",
    "Todo",
    "Blocked",
    "In progress",
    "Review",
    "QA",
    "Done",
    "Parked"
];
const FIELDS = JSON.stringify({
    fields: [{name: "Status", id: "F1", options: NAMES.map(name => ({name, id: `o-${name}`}))}]
});
const META = {
    project: {id: "P1", number: 3},
    field: {id: "F1", options: Object.fromEntries(NAMES.map(name => [name, `o-${name}`]))}
};
const restIssue = (labels, n = 25) =>
    JSON.stringify({
        number: n,
        html_url: `https://github.com/tjlytle/Sozi/issues/${n}`,
        state: "open",
        labels: labels.map(name => ({name}))
    });
const item = (status, updatedAt) =>
    JSON.stringify({data: {node: {id: "I1", updatedAt, status: {name: status, updatedAt}}}});
const lookup = (status, updatedAt, project = "P1") =>
    JSON.stringify({
        data: {
            repository: {
                issue: {
                    projectItems: {
                        nodes: [
                            {
                                id: "I1",
                                updatedAt,
                                project: {id: project},
                                status: {name: status, updatedAt}
                            }
                        ]
                    }
                }
            }
        }
    });
const timeline = at =>
    JSON.stringify([[{event: "labeled", label: {name: "stage:review"}, created_at: at}]]);

/** @type {string[]} */
const scratch = [];
after(() => {
    for (const dir of scratch) {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

/**
 * A state file in a scratch dir.
 * @param {any} contents - What it holds.
 * @returns {string} - Its path.
 */
function stateFile(contents) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-"));
    scratch.push(dir);
    const file = path.join(dir, "state.json");
    fs.writeFileSync(file, JSON.stringify(contents));
    return file;
}

const known = {issues: {25: {board: {item: "I1"}}}};
/** @type {(number: number, labels: string[]) => any} */
const ghIssue = (number, labels) => ({
    number,
    title: `t${number}`,
    labels,
    state: "OPEN",
    body: "",
    updatedAt: "2026-10-21T00:00:00Z"
});
/** @returns {any} - The issues of a state that has read #25. */
const read25 = () => {
    const s = emptyState();
    applyIssue(s, ghIssue(25, ["stage:review"]));
    return s.issues;
};
const edits = calls => calls.filter(c => c[2] === "project" && c[3] === "item-edit");
const isGraphql = c => c.includes("graphql");
const env = {PIPELINE_REPO: REPO};
const quiet = {out() {}, err() {}};

describe("board", () => {
    test("the eleven labels", () => {
        assert.deepEqual(LABELS.map(l => l.name).sort(), [
            "idea",
            "stage:blocked",
            "stage:done",
            "stage:in-progress",
            "stage:parked",
            "stage:qa",
            "stage:review",
            "stage:tests",
            "stage:todo",
            "triage",
            "working"
        ]);
    });
    test("stage to column is many-to-one; column to stage is the entry stage", () => {
        assert.equal(stageToColumn("stage:blocked"), "Blocked");
        assert.equal(stageToColumn("stage:tests"), "In progress");
        assert.equal(stageToColumn("stage:in-progress"), "In progress");
        assert.equal(stageToColumn("triage"), "Triage");
        assert.equal(stageToColumn("closed"), "Done");
        assert.equal(columnToStage("In progress"), "stage:tests");
        assert.equal(columnToStage("Ideas"), "idea");
    });
    test("the label wins unless the card moved after it; a sub-stage in its column is agreement", () => {
        const base = {state: "OPEN", stage: "stage:review", idea: false, triage: false};
        assert.deepEqual(
            decide({
                ...base,
                have: "Todo",
                boardAt: "2026-10-21T01:00:00Z",
                labelAt: "2026-10-21T02:00:00Z"
            }),
            {board: "Review"}
        );
        assert.deepEqual(
            decide({
                ...base,
                have: "QA",
                boardAt: "2026-10-21T03:00:00Z",
                labelAt: "2026-10-21T02:00:00Z"
            }),
            {label: {add: ["stage:qa"], remove: ["stage:review"]}}
        );
        assert.equal(decide({...base, have: "Review", boardAt: "", labelAt: ""}), null);
        assert.equal(
            decide({
                ...base,
                stage: "stage:in-progress",
                have: "In progress",
                boardAt: "2026-10-21T03:00:00Z",
                labelAt: "2026-10-21T02:00:00Z"
            }),
            null
        );
        assert.deepEqual(
            decide({
                ...base,
                stage: "stage:todo",
                have: "In progress",
                boardAt: "2026-10-21T03:00:00Z",
                labelAt: "2026-10-21T02:00:00Z"
            }),
            {label: {add: ["stage:tests"], remove: ["stage:todo"]}}
        );
    });
    test("a closed issue wants Done; an unknown stage gives null", () => {
        const base = {idea: false, triage: false, have: "Review", boardAt: "", labelAt: ""};
        assert.deepEqual(decide({...base, state: "CLOSED", stage: "stage:review"}), {
            board: "Done"
        });
        assert.equal(decide({...base, state: "OPEN", stage: "stage:mystery", have: ""}), null);
        assert.equal(stageToColumn("stage:mystery"), "");
    });
    test("labels issues exactly eleven label create commands", async () => {
        const {run, calls} = fake({});
        const code = await main(["labels"], {env: {PIPELINE_REPO: REPO}, run, out() {}, err() {}});
        assert.equal(code, 0);
        assert.equal(calls.length, 11);
        assert.deepEqual(calls[0], [
            "gh-as",
            "ops",
            "label",
            "create",
            "stage:todo",
            "-R",
            REPO,
            "--color",
            "ededed",
            "--description",
            "Waiting for the architect",
            "--force"
        ]);
        assert.deepEqual(calls[10], [
            "gh-as",
            "ops",
            "label",
            "create",
            "working",
            "-R",
            REPO,
            "--color",
            "bfd4f2",
            "--description",
            "A session holds this issue now",
            "--force"
        ]);
    });
    test("sync --issues moves a card that is in the wrong column", async () => {
        const {run, calls} = fake({
            "gh-as - project list": PROJECT,
            "gh-as - project field-list": FIELDS,
            "gh-as ops api repos": restIssue(["stage:review"]),
            "gh-as - api graphql": item("Todo", "2026-10-21T01:00:00Z"),
            "gh-as - api --paginate": timeline("2026-10-21T02:00:00Z")
        });
        const lines = [];
        const code = await main(["sync", "--issues", "25", "--state", stateFile(known)], {
            env,
            run,
            out: t => lines.push(t),
            err() {}
        });
        assert.equal(code, 0);
        assert.deepEqual(edits(calls), [
            [
                "gh-as",
                "-",
                "project",
                "item-edit",
                "--project-id",
                "P1",
                "--id",
                "I1",
                "--field-id",
                "F1",
                "--single-select-option-id",
                "o-Review"
            ]
        ]);
        assert.equal(calls.filter(c => c.includes("issue") && c.includes("edit")).length, 0);
        assert.deepEqual(lines, ["#25 board ← label: Review\n"]);
    });
    test("sync --issues moves the label when the card moved after it", async () => {
        const {run, calls} = fake({
            "gh-as - project list": PROJECT,
            "gh-as - project field-list": FIELDS,
            "gh-as ops api repos": restIssue(["stage:review"]),
            "gh-as - api graphql": item("QA", "2026-10-21T03:00:00Z"),
            "gh-as - api --paginate": timeline("2026-10-21T02:00:00Z")
        });
        const lines = [];
        await main(["sync", "--issues", "25", "--state", stateFile(known)], {
            env,
            run,
            out: t => lines.push(t),
            err() {}
        });
        assert.deepEqual(
            calls.filter(c => c[2] === "issue" && c[3] === "edit"),
            [
                [
                    "gh-as",
                    "ops",
                    "issue",
                    "edit",
                    "25",
                    "-R",
                    REPO,
                    "--add-label",
                    "stage:qa",
                    "--remove-label",
                    "stage:review"
                ]
            ]
        );
        assert.equal(calls.filter(c => c[2] === "project" && c[3].startsWith("item-")).length, 0);
        assert.deepEqual(lines, ["#25 label ← board: QA\n"]);
    });
    for (const [label, contents] of [
        ["no state file", null],
        ["no entry for the issue", {issues: {}}]
    ]) {
        describe(`an unknown card (${label})`, () => {
            const replies = (status, at) => ({
                "gh-as - project list": PROJECT,
                "gh-as - project field-list": FIELDS,
                "gh-as ops api repos": restIssue(["stage:review"]),
                "gh-as - api graphql": lookup(status, at),
                "gh-as - api --paginate": timeline("2026-10-21T02:00:00Z")
            });
            const argv = () => [
                "sync",
                "--issues",
                "25",
                ...(contents ? ["--state", stateFile(contents)] : [])
            ];
            test("is looked up, and a card in the right column is left alone", async () => {
                const {run, calls} = fake(replies("Review", "2026-10-21T01:00:00Z"));
                await main(argv(), {env, run, ...quiet});
                const query = calls.filter(isGraphql);
                assert.equal(query.length, 1);
                assert.ok(query[0].some(a => a.includes("projectItems")));
                assert.equal(edits(calls).length, 0);
                assert.equal(calls.filter(c => c[3] === "item-add").length, 0);
            });
            test("is looked up, and a card moved after the label still wins", async () => {
                const {run, calls} = fake(replies("QA", "2026-10-21T03:00:00Z"));
                await main(argv(), {env, run, ...quiet});
                assert.equal(edits(calls).length, 0);
                assert.deepEqual(
                    calls.filter(c => c[2] === "issue" && c[3] === "edit"),
                    [
                        [
                            "gh-as",
                            "ops",
                            "issue",
                            "edit",
                            "25",
                            "-R",
                            REPO,
                            "--add-label",
                            "stage:qa",
                            "--remove-label",
                            "stage:review"
                        ]
                    ]
                );
            });
        });
    }
    test("a card on another board is not this one, so the issue is added", async () => {
        const {run, calls} = fake({
            "gh-as - project list": PROJECT,
            "gh-as - project field-list": FIELDS,
            "gh-as ops api repos": restIssue(["stage:review"]),
            "gh-as - api graphql": lookup("Review", "2026-10-21T01:00:00Z", "OTHER"),
            "gh-as - project item-add": JSON.stringify({id: "NEW"})
        });
        const file = stateFile({issues: read25()});
        await main(["sync", "--issues", "25", "--state", file], {env, run, ...quiet});
        assert.equal(calls.filter(c => c[3] === "item-add").length, 1);
        assert.equal(edits(calls)[0][7], "NEW");
        assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).issues[25].board.item, "NEW");
    });
    test("the state file is re-read just before it is written", async () => {
        const file = stateFile({issues: {}});
        const {run} = fake(
            {
                "gh-as - project list": PROJECT,
                "gh-as - project field-list": FIELDS,
                "gh-as ops api repos": restIssue(["stage:review"]),
                "gh-as - api graphql": lookup("", "", "OTHER"),
                "gh-as - project item-add": JSON.stringify({id: "NEW"})
            },
            cmd => {
                if (cmd[3] === "item-add") {
                    const issues = {...read25(), 40: {tries: 2}};
                    fs.writeFileSync(file, JSON.stringify({issues, run: {x: 1}}));
                }
            }
        );
        await main(["sync", "--issues", "25", "--state", file], {env, run, ...quiet});
        const after = JSON.parse(fs.readFileSync(file, "utf8"));
        assert.deepEqual(after.issues[40], {tries: 2});
        assert.deepEqual(after.run, {x: 1});
        assert.equal(after.issues[25].board.item, "NEW");
    });
    test("a given book is changed in place and a missing issues object writes nothing", async () => {
        const {run} = fake({
            "gh-as ops api repos": restIssue(["stage:review"]),
            "gh-as - api graphql": lookup("", "", "OTHER"),
            "gh-as - project item-add": JSON.stringify({id: "NEW"})
        });
        const book = {boardMeta: META, issues: read25()};
        const result = await sync({issues: [25], book}, {repo: REPO, run, out() {}});
        assert.deepEqual(result, {failed: []});
        assert.equal(book.issues[25].board.item, "NEW");
        const bare = {boardMeta: META};
        await sync({issues: [25], book: bare}, {repo: REPO, run, out() {}});
        assert.equal(bare.issues, undefined);
    });
    describe("a card for an issue the state has not read yet", () => {
        const board = JSON.stringify({
            data: {
                node: {
                    items: {
                        nodes: [24, 25].map(number => ({
                            id: `I${number}`,
                            updatedAt: "2026-10-21T01:00:00Z",
                            content: {number},
                            status: {name: "Todo", updatedAt: "2026-10-21T01:00:00Z"}
                        }))
                    }
                }
            }
        });
        const listed = JSON.stringify(
            [24, 25].map(number => ({
                number,
                url: `https://github.com/tjlytle/Sozi/issues/${number}`,
                state: "OPEN",
                labels: [{name: "stage:review"}]
            }))
        );
        /** @returns {Promise<any>} - The book after a full sync that read #24 and not #25. */
        const fullSync = async () => {
            const book = emptyState();
            book.boardMeta = META;
            applyIssue(book, ghIssue(24, ["stage:todo"]));
            const {run} = fake({
                "gh-as - api graphql": board,
                "gh-as - issue list": listed,
                "gh-as - api --paginate": timeline("2026-10-21T02:00:00Z")
            });
            await sync({all: true, book}, {repo: REPO, run, out() {}});
            return book;
        };
        test("is left out of a full sync; a read issue gets its item", async () => {
            const book = await fullSync();
            assert.equal(25 in book.issues, false);
            assert.equal(book.issues[24].board.item, "I24");
        });
        test("does not stop the loop listing what is due", async () => {
            const book = await fullSync();
            assert.deepEqual(dueIssues(book, {}, new Date()), [24]);
        });
        test("is left out of the state file on sync --issues", async () => {
            const {run} = fake({
                "gh-as - project list": PROJECT,
                "gh-as - project field-list": FIELDS,
                "gh-as ops api repos": restIssue(["stage:review"]),
                "gh-as - api graphql": lookup("Review", "2026-10-21T01:00:00Z")
            });
            const file = stateFile({issues: {}});
            await main(["sync", "--issues", "25", "--state", file], {env, run, ...quiet});
            assert.equal(25 in JSON.parse(fs.readFileSync(file, "utf8")).issues, false);
        });
    });
    test("one failing issue is reported and does not stop the next", async () => {
        const {run, calls} = fake({
            "gh-as ops api repos/tjlytle/Sozi/issues/25": {code: 1, stderr: "boom"},
            "gh-as ops api repos/tjlytle/Sozi/issues/26": restIssue(["stage:review"], 26),
            "gh-as - api graphql": lookup("Review", "2026-10-21T01:00:00Z")
        });
        const errors = [];
        const file = stateFile({issues: {}, boardMeta: META});
        const code = await main(["sync", "--issues", "25,26,25", "--state", file], {
            env,
            run,
            out() {},
            err: t => errors.push(t)
        });
        assert.equal(code, 1);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /^#25: .*boom/);
        const again = fake({
            "gh-as ops api repos/tjlytle/Sozi/issues/25": {code: 1, stderr: "boom"},
            "gh-as ops api repos/tjlytle/Sozi/issues/26": restIssue(["stage:review"], 26),
            "gh-as - api graphql": lookup("Review", "2026-10-21T01:00:00Z")
        });
        const book = {boardMeta: META};
        const ctx = {repo: REPO, run: again.run, out() {}, err() {}};
        assert.deepEqual(await sync({issues: [25, 26], book}, ctx), {failed: [25]});
        assert.equal(
            calls.filter(c => c.join(" ").startsWith("gh-as ops api repos/tjlytle/Sozi/issues/25"))
                .length,
            1
        );
        assert.equal(
            calls.filter(c => c.join(" ").startsWith("gh-as ops api repos/tjlytle/Sozi/issues/26"))
                .length,
            1
        );
    });
    test("a warm board cache and a known item cost one GraphQL call and no board listing", async () => {
        const {run, calls} = fake({
            "gh-as ops api repos": restIssue(["stage:review"]),
            "gh-as - api graphql": item("Review", "2026-10-21T01:00:00Z")
        });
        const file = stateFile({...known, boardMeta: META});
        const code = await main(["sync", "--issues", "25", "--state", file], {env, run, ...quiet});
        assert.equal(code, 0);
        assert.equal(calls.filter(isGraphql).length, 1);
        assert.equal(calls.filter(c => c[2] === "project").length, 0);
        assert.equal(calls.filter(c => c.includes("view")).length, 0);
    });
    test("create drops the cached board details, because recreating the columns changes the option ids", async () => {
        const file = stateFile({issues: {}, boardMeta: META});
        const {run, calls} = fake({
            "gh-as - project list": PROJECT,
            "gh-as - project field-list": JSON.stringify({
                fields: [{name: "Status", id: "F1", options: [{name: "Todo", id: "o-Todo"}]}]
            }),
            "gh-as - api graphql": JSON.stringify({data: {node: {items: {nodes: []}}}}),
            "gh-as - issue list": "[]"
        });
        const code = await main(["create", "--state", file], {env, run, ...quiet});
        assert.equal(code, 0);
        assert.ok(calls.some(c => c.join(" ").includes("updateProjectV2Field")));
        assert.equal("boardMeta" in JSON.parse(fs.readFileSync(file, "utf8")), false);
    });
    test("an item-edit that fails with a stale option id is retried once with fresh board details", async () => {
        let edits = 0;
        const fresh = JSON.stringify({
            fields: [
                {name: "Status", id: "F2", options: NAMES.map(name => ({name, id: `n-${name}`}))}
            ]
        });
        let fieldLists = 0;
        const {run, calls} = fake(
            {
                "gh-as ops api repos": restIssue(["stage:review"]),
                "gh-as - api graphql": item("Todo", "2026-10-21T01:00:00Z"),
                "gh-as - project list": PROJECT,
                "gh-as - api --paginate": timeline("2026-10-21T02:00:00Z")
            },
            cmd => {
                if (cmd[3] === "item-edit") {
                    edits++;
                }
            }
        );
        const wrapped = async cmd => {
            if (cmd[3] === "field-list") {
                fieldLists++;
                calls.push(cmd);
                return {code: 0, stdout: fresh, stderr: ""};
            }
            if (cmd[3] === "item-edit" && edits === 0) {
                edits++;
                calls.push(cmd);
                return {code: 1, stdout: "", stderr: "bad option"};
            }
            return run(cmd);
        };
        const file = stateFile({...known, boardMeta: META});
        const lines = [];
        const code = await main(["sync", "--issues", "25", "--state", file], {
            env,
            run: wrapped,
            out: t => lines.push(t),
            err() {}
        });
        assert.equal(code, 0);
        assert.equal(fieldLists, 1);
        const tries = calls.filter(c => c[3] === "item-edit");
        assert.equal(tries.length, 2);
        assert.equal(tries[0].at(-1), "o-Review");
        assert.equal(tries[1].at(-1), "n-Review");
        assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).boardMeta.field.id, "F2");
        assert.deepEqual(lines, ["#25 board ← label: Review\n"]);
    });
    test("a --state path that does not exist is not created; a warning is printed", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-"));
        scratch.push(dir);
        const file = path.join(dir, "missing.json");
        const {run} = fake({
            "gh-as - project list": PROJECT,
            "gh-as - project field-list": FIELDS,
            "gh-as ops api repos": restIssue(["stage:review"]),
            "gh-as - api graphql": lookup("Review", "2026-10-21T01:00:00Z")
        });
        const errors = [];
        const code = await main(["sync", "--issues", "25", "--state", file], {
            env,
            run,
            out() {},
            err: t => errors.push(t)
        });
        assert.equal(code, 0);
        assert.equal(fs.existsSync(file), false);
        assert.ok(errors.some(e => /missing\.json/.test(e)));
    });
});
