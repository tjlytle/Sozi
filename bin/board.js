#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The stage labels and the GitHub Projects board that mirrors them. Labels are what the
// loop reads (an App cannot see a Projects board); the board is for people. Board reads
// and writes run as the user (`gh-as -`), because only a user can own a board; label
// writes run as ops.
//
//   node bin/board.js labels
//   node bin/board.js create
//   node bin/board.js sync [--all] [--issues n,m] [--state var/pipeline/state.json]
//   node bin/board.js url
//
// Environment: PIPELINE_REPO (owner/name; read from `gh repo view` when unset). `sync`
// keeps labels and board in step: whichever changed last wins, so a loop label move shows
// on the board and a card dragged by a person moves the label; closed issues go to Done.
// It prints `#n board <- label: X` or `#n label <- board: X` per change. `--issues` looks
// the board item up in the state file (issues[n].board.item) and writes it back when it
// adds one. Any other subcommand prints this usage and exits 2.

import fs from "node:fs";
import {parseArgs} from "node:util";
import {pathToFileURL} from "node:url";
import {defaultRun} from "../pipeline/lib/github.js";

const USAGE = [
    "usage:",
    "  node bin/board.js labels",
    "  node bin/board.js create",
    "  node bin/board.js sync [--all] [--issues n,m] [--state FILE]",
    "  node bin/board.js url"
];

/** The title of the board. */
const TITLE = "Sozi pipeline";

/** The board columns in order, with the colour of each. */
const COLUMNS = [
    ["Triage", "RED"],
    ["Ideas", "ORANGE"],
    ["Todo", "GRAY"],
    ["Blocked", "YELLOW"],
    ["In progress", "BLUE"],
    ["Review", "PURPLE"],
    ["QA", "GREEN"],
    ["Done", "PINK"],
    ["Parked", "RED"]
];

/** The eleven labels the loop uses. */
export const LABELS = [
    {name: "stage:todo", color: "ededed", description: "Waiting for the architect"},
    {name: "stage:blocked", color: "fbca04", description: "Waits for the issues its plan names"},
    {name: "stage:tests", color: "c5def5", description: "QA writes the scenarios"},
    {name: "stage:in-progress", color: "1d76db", description: "Being built"},
    {name: "stage:review", color: "fef2c0", description: "PR under review"},
    {name: "stage:qa", color: "0e8a16", description: "Scenarios, evidence, merge"},
    {name: "stage:done", color: "5319e7", description: "Merged"},
    {name: "stage:parked", color: "d93f0b", description: "Mechanical blocker; needs a person"},
    {name: "triage", color: "e99695", description: "Needs Tim"},
    {name: "idea", color: "f9d0c4", description: "An alternative to weigh"},
    {name: "working", color: "bfd4f2", description: "A session holds this issue now"}
];

const STAGE_COLUMN = /** @type {Record<string, string>} */ ({
    triage: "Triage",
    idea: "Ideas",
    "stage:todo": "Todo",
    "stage:blocked": "Blocked",
    "stage:tests": "In progress",
    "stage:in-progress": "In progress",
    "stage:review": "Review",
    "stage:qa": "QA",
    "stage:done": "Done",
    closed: "Done",
    "stage:parked": "Parked"
});

const COLUMN_STAGE = /** @type {Record<string, string>} */ ({
    Todo: "stage:todo",
    Blocked: "stage:blocked",
    "In progress": "stage:tests",
    Review: "stage:review",
    QA: "stage:qa",
    Done: "stage:done",
    Parked: "stage:parked",
    Triage: "triage",
    Ideas: "idea"
});

/** The column a stage (or "closed", "idea", "triage") sits in.
 *
 * @param {string} stage - A stage label, or "closed", "idea" or "triage".
 * @returns {string} - The column name, or "" for anything else.
 */
export function stageToColumn(stage) {
    return Object.hasOwn(STAGE_COLUMN, stage) ? STAGE_COLUMN[stage] : "";
}

/** The stage a card dragged into a column enters.
 *
 * @param {string} column - The column name.
 * @returns {string|null} - The entry stage label, or null for an unknown column.
 */
export function columnToStage(column) {
    return Object.hasOwn(COLUMN_STAGE, column) ? COLUMN_STAGE[column] : null;
}

/**
 * @typedef {object} Decision
 * @property {string} [board] - Move the card to this column.
 * @property {{add: string[], remove: string[]}} [label] - Edit the issue labels.
 */

/** Decide what to change when the labels and the board may disagree. Whichever changed
 * last wins; a card in the column its stage maps to is agreement, whatever the sub-stage.
 *
 * @param {object} facts - What is known about one issue.
 * @param {string} facts.state - OPEN or CLOSED.
 * @param {string} facts.stage - Its stage label, or "".
 * @param {boolean} facts.idea - Whether it has the idea label.
 * @param {boolean} facts.triage - Whether it has the triage label.
 * @param {string} facts.have - The column its card is in, or "".
 * @param {string} facts.boardAt - When the card last changed, or "".
 * @param {string} facts.labelAt - When the label last changed, or "".
 * @returns {Decision|null} - The change to make, or null for none.
 */
export function decide({state, stage, idea, triage, have, boardAt, labelAt}) {
    const want = stageToColumn(
        state === "CLOSED" ? "closed" : stage || (triage ? "triage" : idea ? "idea" : "")
    );
    if (have === want) {
        return null;
    }
    if (have && state === "OPEN" && boardAt && boardAt > labelAt) {
        const entry = columnToStage(have);
        return entry ? {label: {add: [entry], remove: [stage].filter(Boolean)}} : null;
    }
    return want ? {board: want} : null;
}

/**
 * @typedef {(cmd: string[]) => Promise<{code: number, stdout: string, stderr: string}>} Run
 */

/**
 * @typedef {object} Context
 * @property {string} repo - The repository, owner/name.
 * @property {Run} run - The command runner.
 * @property {(text: string) => void} out - Standard output.
 */

/** Run a command and return its output, throwing on failure.
 *
 * @param {Run} run - The runner.
 * @param {string[]} cmd - The command.
 * @returns {Promise<string>} - Standard output.
 */
async function exec(run, cmd) {
    const r = await run(cmd);
    if (r.code !== 0) {
        throw new Error(`${cmd.slice(0, 4).join(" ")} failed (${r.code}): ${r.stderr.trim()}`);
    }
    return r.stdout;
}

/** The board project, if it exists.
 *
 * @param {Context} ctx - The context.
 * @returns {Promise<{number: number, id: string}|null>} - The project.
 */
async function findProject({repo, run}) {
    const owner = repo.split("/")[0];
    const list = JSON.parse(
        await exec(run, [
            "gh-as",
            "-",
            "project",
            "list",
            "--owner",
            owner,
            "--format",
            "json",
            "--limit",
            "100"
        ])
    );
    return (list.projects ?? []).find((/** @type {any} */ p) => p.title === TITLE) ?? null;
}

/** The Status field of a board.
 *
 * @param {Context} ctx - The context.
 * @param {number} number - The project number.
 * @returns {Promise<{id: string, options: {id: string, name: string}[]}>} - The field.
 */
async function statusField({repo, run}, number) {
    const owner = repo.split("/")[0];
    const fields = JSON.parse(
        await exec(run, [
            "gh-as",
            "-",
            "project",
            "field-list",
            String(number),
            "--owner",
            owner,
            "--format",
            "json"
        ])
    );
    const field = (fields.fields ?? []).find((/** @type {any} */ f) => f.name === "Status");
    if (!field) {
        throw new Error("the board has no Status field");
    }
    return {id: field.id, options: field.options ?? []};
}

const ITEM_FIELDS = `id updatedAt
    content { ... on Issue { number } }
    status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt } }`;

/** Read a board item from GraphQL.
 *
 * @param {any} node - The item.
 * @returns {{id: string, status: string, at: string}} - Its id, column and change time.
 */
function itemRow(node) {
    return {
        id: node.id,
        status: node.status?.name ?? "",
        at: node.status?.updatedAt ?? node.updatedAt ?? ""
    };
}

/** When the issue stage, triage or idea label was last set.
 *
 * @param {Context} ctx - The context.
 * @param {number} n - The issue number.
 * @returns {Promise<string>} - The ISO time, or "".
 */
async function labelTime({repo, run}, n) {
    const pages = JSON.parse(
        await exec(run, [
            "gh-as",
            "-",
            "api",
            "--paginate",
            "--slurp",
            `repos/${repo}/issues/${n}/timeline?per_page=100`
        ])
    );
    const times = pages
        .flat()
        .filter(
            (/** @type {any} */ e) =>
                e.event === "labeled" &&
                (String(e.label?.name).startsWith("stage:") ||
                    ["triage", "idea"].includes(e.label?.name))
        )
        .map((/** @type {any} */ e) => String(e.created_at));
    return times.sort().pop() ?? "";
}

/** Create the eleven labels; running it again changes nothing.
 *
 * @param {Context} ctx - The context.
 * @returns {Promise<void>}
 */
async function makeLabels({repo, run}) {
    for (const {name, color, description} of LABELS) {
        await exec(run, [
            "gh-as",
            "ops",
            "label",
            "create",
            name,
            "-R",
            repo,
            "--color",
            color,
            "--description",
            description,
            "--force"
        ]);
    }
}

/** Keep labels and board in step.
 *
 * @param {object} options - What to sync.
 * @param {number[]} [options.issues] - Only these issues, unless `all`.
 * @param {boolean} [options.all] - Every issue, reading the board items in bulk.
 * @param {string} [options.state] - The state file that holds board item ids for `issues`.
 * @param {Context} ctx - The context.
 * @returns {Promise<void>}
 */
export async function sync({issues = [], all = false, state}, ctx) {
    const {repo, run, out} = ctx;
    const owner = repo.split("/")[0];
    const project = await findProject(ctx);
    if (!project) {
        throw new Error("no board; run node bin/board.js create");
    }
    const field = await statusField(ctx, project.number);
    const book = state && fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, "utf8")) : null;
    /** @type {Map<number, {id: string, status: string, at: string}>} */
    const cards = new Map();
    /** @type {any[]} */
    let list = [];
    if (all) {
        const reply = JSON.parse(
            await exec(run, [
                "gh-as",
                "-",
                "api",
                "graphql",
                "-f",
                `id=${project.id}`,
                "-f",
                `query=query($id: ID!) { node(id: $id) { ... on ProjectV2 { items(first: 100) { nodes { ${ITEM_FIELDS} } } } } }`
            ])
        );
        for (const node of reply.data?.node?.items?.nodes ?? []) {
            if (node.content?.number !== undefined && node.content.number !== null) {
                cards.set(node.content.number, itemRow(node));
            }
        }
        list = JSON.parse(
            await exec(run, [
                "gh-as",
                "-",
                "issue",
                "list",
                "-R",
                repo,
                "--state",
                "all",
                "--limit",
                "200",
                "--json",
                "number,url,state,labels"
            ])
        );
    } else {
        for (const n of issues) {
            list.push(
                JSON.parse(
                    await exec(run, [
                        "gh-as",
                        "-",
                        "issue",
                        "view",
                        String(n),
                        "-R",
                        repo,
                        "--json",
                        "number,url,state,labels"
                    ])
                )
            );
            const known = book?.issues?.[n]?.board;
            const id = typeof known === "string" ? known : known?.item;
            if (id) {
                const reply = JSON.parse(
                    await exec(run, [
                        "gh-as",
                        "-",
                        "api",
                        "graphql",
                        "-f",
                        `id=${id}`,
                        "-f",
                        `query=query($id: ID!) { node(id: $id) { ... on ProjectV2Item { ${ITEM_FIELDS} } } }`
                    ])
                );
                if (reply.data?.node) {
                    cards.set(n, itemRow(reply.data.node));
                }
            }
        }
    }
    for (const issue of list) {
        const names = (issue.labels ?? []).map((/** @type {any} */ l) => l.name);
        const stage = names.find((/** @type {string} */ x) => x.startsWith("stage:")) ?? "";
        const facts = {
            state: issue.state,
            stage,
            idea: names.includes("idea"),
            triage: names.includes("triage")
        };
        const card = cards.get(issue.number);
        const have = card?.status ?? "";
        const boardAt = card?.at ?? "";
        let decision = decide({...facts, have, boardAt, labelAt: ""});
        if (decision?.label) {
            decision = decide({
                ...facts,
                have,
                boardAt,
                labelAt: await labelTime(ctx, issue.number)
            });
        }
        if (!decision) {
            continue;
        }
        if (decision.label) {
            const cmd = ["gh-as", "ops", "issue", "edit", String(issue.number), "-R", repo];
            if (decision.label.add.length) {
                cmd.push("--add-label", decision.label.add.join(","));
            }
            if (decision.label.remove.length) {
                cmd.push("--remove-label", decision.label.remove.join(","));
            }
            await exec(run, cmd);
            out(`#${issue.number} label ← board: ${have}\n`);
            continue;
        }
        let id = card?.id;
        if (!id) {
            const added = JSON.parse(
                await exec(run, [
                    "gh-as",
                    "-",
                    "project",
                    "item-add",
                    String(project.number),
                    "--owner",
                    owner,
                    "--url",
                    issue.url,
                    "--format",
                    "json"
                ])
            );
            id = String(added.id);
            if (book && state) {
                book.issues[issue.number] = {...book.issues[issue.number], board: {item: id}};
                fs.writeFileSync(state, `${JSON.stringify(book, null, 2)}\n`);
            }
        }
        const option = field.options.find(o => o.name === decision.board);
        if (!option) {
            throw new Error(`the board has no column ${decision.board}`);
        }
        await exec(run, [
            "gh-as",
            "-",
            "project",
            "item-edit",
            "--project-id",
            project.id,
            "--id",
            id,
            "--field-id",
            field.id,
            "--single-select-option-id",
            option.id
        ]);
        out(`#${issue.number} board ← label: ${decision.board}\n`);
    }
}

/** Make the board, link it to the repository and give its Status field the columns.
 * Setting the options recreates them and blanks every card, so it only happens when a
 * column is missing, and a full sync follows to fill the cards back in.
 *
 * @param {Context} ctx - The context.
 * @returns {Promise<void>}
 */
async function create(ctx) {
    const {repo, run, out} = ctx;
    const owner = repo.split("/")[0];
    let project = await findProject(ctx);
    if (!project) {
        await exec(run, [
            "gh-as",
            "-",
            "project",
            "create",
            "--owner",
            owner,
            "--title",
            TITLE,
            "--format",
            "json"
        ]);
        project = await findProject(ctx);
    }
    if (!project) {
        throw new Error("the board was not created");
    }
    await run([
        "gh-as",
        "-",
        "project",
        "link",
        String(project.number),
        "--owner",
        owner,
        "--repo",
        repo
    ]);
    const field = await statusField(ctx, project.number);
    const have = field.options.map(o => o.name);
    if (COLUMNS.some(([name]) => !have.includes(name))) {
        const options = COLUMNS.map(
            ([name, color]) => `{name:"${name}",color:${color},description:""}`
        ).join(",");
        await exec(run, [
            "gh-as",
            "-",
            "api",
            "graphql",
            "-f",
            `query=mutation { updateProjectV2Field(input:{fieldId:"${field.id}", singleSelectOptions:[${options}]}) { projectV2Field { ... on ProjectV2SingleSelectField { options { name } } } } }`
        ]);
        await sync({all: true}, ctx);
    } else {
        out("columns already in place\n");
    }
    out(`https://github.com/users/${owner}/projects/${project.number}\n`);
}

/** Run the command line.
 *
 * @param {string[]} argv - The arguments after the script name.
 * @param {object} [io] - Where things come from and go to.
 * @param {Record<string, string|undefined>} [io.env] - The environment.
 * @param {Run} [io.run] - The command runner.
 * @param {(text: string) => void} [io.out] - Standard output.
 * @param {(text: string) => void} [io.err] - Standard error.
 * @returns {Promise<number>} - The exit status.
 */
export async function main(argv, {env = process.env, run = defaultRun, out, err} = {}) {
    const write = out ?? (text => void process.stdout.write(text));
    const writeErr = err ?? (text => void process.stderr.write(text));
    const [command, ...rest] = argv;
    if (!["labels", "create", "sync", "url"].includes(command ?? "")) {
        writeErr(`${USAGE.join("\n")}\n`);
        return 2;
    }
    try {
        const {values} = parseArgs({
            args: rest,
            options: {
                all: {type: "boolean"},
                issues: {type: "string"},
                state: {type: "string"}
            }
        });
        const repo =
            env.PIPELINE_REPO ??
            (
                await exec(run, [
                    "gh",
                    "repo",
                    "view",
                    "--json",
                    "nameWithOwner",
                    "--jq",
                    ".nameWithOwner"
                ])
            ).trim();
        const ctx = {repo, run, out: write};
        if (command === "labels") {
            await makeLabels(ctx);
        } else if (command === "create") {
            await create(ctx);
        } else if (command === "url") {
            const project = await findProject(ctx);
            if (!project) {
                throw new Error("no board; run node bin/board.js create");
            }
            write(`https://github.com/users/${repo.split("/")[0]}/projects/${project.number}\n`);
        } else {
            const issues = (values.issues ?? "")
                .split(",")
                .filter(Boolean)
                .map(s => {
                    if (!/^\d+$/.test(s)) {
                        throw new Error(`--issues must be numbers: ${JSON.stringify(s)}`);
                    }
                    return Number(s);
                });
            if (!values.all && !issues.length) {
                throw new Error("sync needs --all or --issues n,m");
            }
            await sync({issues, all: values.all, state: values.state}, ctx);
        }
        return 0;
    } catch (error) {
        writeErr(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(await main(process.argv.slice(2)));
}
