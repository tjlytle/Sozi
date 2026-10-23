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
// It prints `#n board ← label: X` or `#n label ← board: X` per change. `--issues` looks
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
 * @property {(text: string) => void} [err] - Standard error.
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

/**
 * @typedef {object} BoardMeta
 * @property {{id: string, number: number}} project - The board.
 * @property {{id: string, options: Record<string, string>}} field - The Status field and its option ids by column name.
 */

/** The board, its Status field and the option ids: from the cache when it holds them,
 * otherwise read from GitHub.
 *
 * @param {Context} ctx - The context.
 * @param {any} book - The state, whose boardMeta is the cache.
 * @param {(change: (b: any) => void) => void} save - Writes a change to the state.
 * @returns {Promise<BoardMeta>} - The board details.
 */
async function boardMeta(ctx, book, save) {
    const cached = book?.boardMeta;
    if (cached?.project?.id && cached?.field?.id && cached?.field?.options) {
        return cached;
    }
    const project = await findProject(ctx);
    if (!project) {
        throw new Error("no board; run node bin/board.js create");
    }
    const field = await statusField(ctx, project.number);
    /** @type {BoardMeta} */
    const meta = {
        project: {id: project.id, number: project.number},
        field: {id: field.id, options: Object.fromEntries(field.options.map(o => [o.name, o.id]))}
    };
    save(b => {
        b.boardMeta = meta;
    });
    return meta;
}

/** Read and change the state: in place for a given book, else through the file, which is
 * re-read just before each write so only the changed keys are set. A file that does not
 * exist is never created.
 *
 * @param {{state?: string, book?: any}} where - The file and the in-memory state.
 * @param {Context} ctx - The context.
 * @returns {{local: any, save: (change: (b: any) => void) => void}} - The state as read and a writer.
 */
function stateAccess({state, book}, ctx) {
    const fromFile = () =>
        state && fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, "utf8")) : null;
    const local = book ?? fromFile();
    let warned = false;
    /** @param {(b: any) => void} change - The change. */
    const save = change => {
        if (book) {
            change(book);
            return;
        }
        if (!state) {
            return;
        }
        const fresh = fromFile();
        if (!fresh) {
            if (!warned) {
                warned = true;
                (ctx.err ?? (() => {}))(`warning: ${state} does not exist; state not written\n`);
            }
            return;
        }
        change(fresh);
        fs.writeFileSync(state, `${JSON.stringify(fresh, null, 2)}\n`);
        if (local) {
            change(local);
        }
    };
    return {local, save};
}

/**
 * @typedef {object} SyncOptions
 * @property {number[]} [issues] - Only these issues, unless `all`.
 * @property {boolean} [all] - Every issue, reading the board items in bulk.
 * @property {string} [state] - A state file for board item ids and the cached board details.
 * @property {any} [book] - The loop in-memory state; when given it is changed in place and never written to a file.
 */

/** Keep labels and board in step. Only `book.issues[n].board` and `book.boardMeta` are
 * written. A failure on one issue is reported and the others carry on.
 *
 * @param {SyncOptions} options - What to sync.
 * @param {Context} ctx - The context.
 * @returns {Promise<{failed: number[]}>} - The issues that failed, so a caller can retry them.
 */
export async function sync({issues = [], all = false, state, book}, ctx) {
    const {repo, run, out} = ctx;
    const [owner] = repo.split("/");
    const {local, save} = stateAccess({state, book}, ctx);
    let meta = await boardMeta(ctx, local, save);
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
                `id=${meta.project.id}`,
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
    }
    /** @type {number[]} */
    const failed = [];
    for (const target of all ? list : issues) {
        const n = all ? target.number : target;
        try {
            let issue = target;
            let card = cards.get(n);
            if (!all) {
                // The REST endpoint: gh issue view is GraphQL under the hood and costs more.
                const rest = JSON.parse(
                    await exec(run, ["gh-as", "ops", "api", `repos/${repo}/issues/${n}`])
                );
                issue = {
                    number: n,
                    url: rest.html_url,
                    state: String(rest.state).toUpperCase(),
                    labels: rest.labels ?? []
                };
                card = await findCard(ctx, local, n, meta.project.id);
            }
            const names = (issue.labels ?? []).map((/** @type {any} */ l) => l.name);
            const stage = names.find((/** @type {string} */ x) => x.startsWith("stage:")) ?? "";
            const facts = {
                state: issue.state,
                stage,
                idea: names.includes("idea"),
                triage: names.includes("triage")
            };
            const have = card?.status ?? "";
            const boardAt = card?.at ?? "";
            let decision = decide({...facts, have, boardAt, labelAt: ""});
            if (decision?.label) {
                decision = decide({...facts, have, boardAt, labelAt: await labelTime(ctx, n)});
            }
            if (!decision) {
                if (card && !all) {
                    remember(local, save, n, card.id);
                }
                continue;
            }
            if (decision.label) {
                const cmd = ["gh-as", "ops", "issue", "edit", String(n), "-R", repo];
                if (decision.label.add.length) {
                    cmd.push("--add-label", decision.label.add.join(","));
                }
                if (decision.label.remove.length) {
                    cmd.push("--remove-label", decision.label.remove.join(","));
                }
                await exec(run, cmd);
                out(`#${n} label ← board: ${have}\n`);
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
                        String(meta.project.number),
                        "--owner",
                        owner,
                        "--url",
                        issue.url,
                        "--format",
                        "json"
                    ])
                );
                id = String(added.id);
            }
            remember(local, save, n, id);
            /** @param {BoardMeta} m - The board details to edit with.
             * @returns {Promise<{code: number, stdout: string, stderr: string}>} - The result.
             */
            const edit = m =>
                run([
                    "gh-as",
                    "-",
                    "project",
                    "item-edit",
                    "--project-id",
                    m.project.id,
                    "--id",
                    String(id),
                    "--field-id",
                    m.field.id,
                    "--single-select-option-id",
                    m.field.options[decision.board ?? ""] ?? ""
                ]);
            if (!meta.field.options[decision.board ?? ""]) {
                throw new Error(`the board has no column ${decision.board}`);
            }
            let result = await edit(meta);
            if (result.code !== 0) {
                // The cached ids may be dead (the columns were recreated): resolve them once more.
                save(b => {
                    delete b.boardMeta;
                });
                meta = await boardMeta(ctx, null, save);
                if (!meta.field.options[decision.board ?? ""]) {
                    throw new Error(`the board has no column ${decision.board}`);
                }
                result = await edit(meta);
                if (result.code !== 0) {
                    throw new Error(
                        `project item-edit failed (${result.code}): ${result.stderr.trim()}`
                    );
                }
            }
            out(`#${n} board ← label: ${decision.board}\n`);
        } catch (error) {
            failed.push(n);
            (ctx.err ?? (() => {}))(
                `#${n}: ${error instanceof Error ? error.message : String(error)}\n`
            );
        }
    }
    return {failed};
}

/** Record the board item of an issue the state already holds, if it is not there already.
 * An issue the state has not read yet is left out: a record made here would hold only the
 * item, and the loop reads every record as a whole issue. The next issue sync reads it in
 * full and its next board sync finds the item again.
 *
 * @param {any} local - The state as last read.
 * @param {(change: (b: any) => void) => void} save - Writes a change to the state.
 * @param {number} n - The issue number.
 * @param {string} id - The board item id.
 */
function remember(local, save, n, id) {
    const known = local?.issues?.[n]?.board;
    if ((typeof known === "string" ? known : known?.item) === id) {
        return;
    }
    save(b => {
        if (!b.issues?.[n]) {
            return;
        }
        b.issues[n] = {...b.issues[n], board: {item: id}};
    });
}

/** Find the card of one issue on this board: by the item id the state holds, and when
 * that is missing or stale, by asking GitHub for the project items of the issue.
 *
 * @param {Context} ctx - The context.
 * @param {any} book - The state.
 * @param {number} n - The issue number.
 * @param {string} projectId - The board id.
 * @returns {Promise<{id: string, status: string, at: string}|undefined>} - The card, if any.
 */
async function findCard({repo, run}, book, n, projectId) {
    const known = book?.issues?.[n]?.board;
    const id = typeof known === "string" ? known : known?.item;
    if (id) {
        const r = await run([
            "gh-as",
            "-",
            "api",
            "graphql",
            "-f",
            `id=${id}`,
            "-f",
            `query=query($id: ID!) { node(id: $id) { ... on ProjectV2Item { ${ITEM_FIELDS} } } }`
        ]);
        if (r.code === 0) {
            const node = JSON.parse(r.stdout).data?.node;
            if (node) {
                return itemRow(node);
            }
        }
        // A stale id: look the card up again.
    }
    const [owner, name] = repo.split("/");
    const reply = JSON.parse(
        await exec(run, [
            "gh-as",
            "-",
            "api",
            "graphql",
            "-f",
            `owner=${owner}`,
            "-f",
            `name=${name}`,
            "-F",
            `number=${n}`,
            "-f",
            `query=query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { projectItems(first: 20) { nodes { id updatedAt project { id } status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt } } } } } } }`
        ])
    );
    const nodes = reply.data?.repository?.issue?.projectItems?.nodes ?? [];
    const mine = nodes.find((/** @type {any} */ x) => x.project?.id === projectId);
    return mine ? itemRow(mine) : undefined;
}

/** Make the board, link it to the repository and give its Status field the columns.
 * Setting the options recreates them and blanks every card, so it only happens when a
 * column is missing, and a full sync follows to fill the cards back in.
 *
 * @param {Context} ctx - The context.
 * @param {{state?: string, book?: any}} [where] - The state, whose cached board details are dropped.
 * @returns {Promise<void>}
 */
async function create(ctx, where = {}) {
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
    // Linking an already linked board fails; that is fine, so the result is ignored.
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
        // The option ids changed, so any cached board details are dead.
        stateAccess(where, ctx).save(b => {
            delete b.boardMeta;
        });
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
        const ctx = {repo, run, out: write, err: writeErr};
        if (command === "labels") {
            await makeLabels(ctx);
        } else if (command === "create") {
            await create(ctx, {state: values.state});
        } else if (command === "url") {
            const project = await findProject(ctx);
            if (!project) {
                throw new Error("no board; run node bin/board.js create");
            }
            write(`https://github.com/users/${repo.split("/")[0]}/projects/${project.number}\n`);
        } else {
            const issues = [
                ...new Set(
                    (values.issues ?? "")
                        .split(",")
                        .filter(Boolean)
                        .map(s => {
                            if (!/^\d+$/.test(s)) {
                                throw new Error(`--issues must be numbers: ${JSON.stringify(s)}`);
                            }
                            return Number(s);
                        })
                )
            ];
            if (!values.all && !issues.length) {
                throw new Error("sync needs --all or --issues n,m");
            }
            const {failed} = await sync({issues, all: values.all, state: values.state}, ctx);
            return failed.length ? 1 : 0;
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
