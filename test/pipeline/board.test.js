import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {LABELS, stageToColumn, columnToStage, decide, main} from "../../bin/board.js";

/**
 * A fake runner that replays canned replies by command prefix and records every command.
 * @param {Record<string, string>} replies - Joined command prefix to stdout.
 * @returns {{run: (cmd: string[]) => Promise<any>, calls: string[][]}} - The runner and its log.
 */
function fake(replies) {
    /** @type {string[][]} */
    const calls = [];
    return {
        calls,
        async run(cmd) {
            calls.push(cmd);
            const line = cmd.join(" ");
            const key = Object.keys(replies)
                .sort((a, b) => b.length - a.length)
                .find(k => line.startsWith(k));
            return {code: 0, stdout: key === undefined ? "" : replies[key], stderr: ""};
        }
    };
}

const REPO = "tjlytle/Sozi";
const PROJECT = JSON.stringify({projects: [{title: "Sozi pipeline", number: 3, id: "P1"}]});
const FIELDS = JSON.stringify({
    fields: [
        {
            name: "Status",
            id: "F1",
            options: [
                "Triage",
                "Ideas",
                "Todo",
                "Blocked",
                "In progress",
                "Review",
                "QA",
                "Done",
                "Parked"
            ].map(name => ({name, id: `o-${name}`}))
        }
    ]
});
const issueView = labels =>
    JSON.stringify({
        number: 25,
        url: "https://github.com/tjlytle/Sozi/issues/25",
        state: "OPEN",
        labels: labels.map(name => ({name}))
    });
const item = (status, updatedAt) =>
    JSON.stringify({data: {node: {id: "I1", updatedAt, status: {name: status, updatedAt}}}});

/**
 * A state file in a scratch dir.
 * @returns {string} - Its path.
 */
function stateFile() {
    const dir = fs.mkdtempSync(path.join(".agents/tmp", "board-"));
    const file = path.join(dir, "state.json");
    fs.writeFileSync(file, JSON.stringify({issues: {25: {board: {item: "I1"}}}}));
    return file;
}

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
            "gh-as - issue view": issueView(["stage:review"]),
            "gh-as - api graphql": item("Todo", "2026-10-21T01:00:00Z"),
            "gh-as - api --paginate": JSON.stringify([
                [
                    {
                        event: "labeled",
                        label: {name: "stage:review"},
                        created_at: "2026-10-21T02:00:00Z"
                    }
                ]
            ])
        });
        const lines = [];
        const code = await main(["sync", "--issues", "25", "--state", stateFile()], {
            env: {PIPELINE_REPO: REPO},
            run,
            out: t => lines.push(t),
            err() {}
        });
        assert.equal(code, 0);
        const edits = calls.filter(c => c[2] === "project" && c[3] === "item-edit");
        assert.deepEqual(edits, [
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
            "gh-as - issue view": issueView(["stage:review"]),
            "gh-as - api graphql": item("QA", "2026-10-21T03:00:00Z"),
            "gh-as - api --paginate": JSON.stringify([
                [
                    {
                        event: "labeled",
                        label: {name: "stage:review"},
                        created_at: "2026-10-21T02:00:00Z"
                    }
                ]
            ])
        });
        const lines = [];
        await main(["sync", "--issues", "25", "--state", stateFile()], {
            env: {PIPELINE_REPO: REPO},
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
});
