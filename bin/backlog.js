#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The backlog epic (PIPELINE_BACKLOG): what the agents filed while they worked, for Tim to
// triage. `list` reads; `move` and `close` act as Tim (`gh-as -`), since triage is his call.
//
//   node bin/backlog.js list [--json]
//   node bin/backlog.js move <n>... --epic <#> [--stage todo]
//   node bin/backlog.js close <n>... --reason "<why>"
//
// `list` prints the open sub-issues of the backlog grouped by kind (triage, then the stage
// labels, then ideas), one line each: number, persona that filed it, the issue it came
// from, title. `move` rewrites the issue's `Part of` line to the epic, moves the sub-issue
// link, drops `idea` and `triage`, and with `--stage todo` adds `stage:todo` so the loop
// plans it. `close` comments the reason and closes the issue as not planned. A bad call
// prints the usage and exits 2.

import {parseArgs} from "node:util";
import {pathToFileURL} from "node:url";
import {defaultRun} from "../pipeline/lib/github.js";
import {loadConfig} from "../pipeline/lib/config.js";

const USAGE = [
    "usage:",
    "  node bin/backlog.js list [--json]",
    "  node bin/backlog.js move <n>... --epic <#> [--stage todo]",
    '  node bin/backlog.js close <n>... --reason "<why>"'
];

/** The order the kinds are listed in: what needs Tim first, ideas last. */
const KIND_ORDER = [
    "triage",
    "stage:todo",
    "stage:blocked",
    "stage:tests",
    "stage:in-progress",
    "stage:review",
    "stage:qa",
    "stage:parked",
    "idea",
    "none"
];

/**
 * @typedef {object} BacklogIssue
 * @property {number} number - The issue number.
 * @property {string} title - The title.
 * @property {string} kind - `triage`, the stage label, `idea`, or `none`.
 * @property {string} persona - The persona that filed it, or the login of a person.
 * @property {number | null} origin - The issue or PR it was found on, when the body says.
 * @property {string} created - The day it was filed (YYYY-MM-DD).
 */

/**
 * Describe one issue of the REST sub-issues list for triage.
 *
 * @param {any} raw - The issue as the REST API returns it.
 * @returns {BacklogIssue} - The description.
 */
export function describeIssue(raw) {
    const labels = (raw.labels ?? []).map((/** @type {any} */ l) => l.name);
    const kind =
        (labels.includes("triage") && "triage") ||
        labels.find((/** @type {string} */ l) => l.startsWith("stage:")) ||
        (labels.includes("idea") && "idea") ||
        "none";
    const login = String(raw.user?.login ?? "");
    const persona = login
        .replace(/^ll-/, "")
        .replace(/\[bot\]$/, "")
        .replace(/^operations$/, "ops");
    const origin = /^(?:Seen while \w+ #|Chosen against in #)(\d+)/.exec(raw.body ?? "");
    return {
        number: raw.number,
        title: raw.title,
        kind,
        persona,
        origin: origin ? Number(origin[1]) : null,
        created: String(raw.created_at ?? "").slice(0, 10)
    };
}

/**
 * The backlog as text: a count, then one block per kind.
 *
 * @param {number} epic - The backlog epic.
 * @param {BacklogIssue[]} issues - The open issues, in list order.
 * @returns {string} - The text.
 */
export function listText(epic, issues) {
    const lines = [`Backlog #${epic}: ${issues.length} open`];
    for (const kind of KIND_ORDER) {
        const group = issues.filter(i => i.kind === kind);
        if (group.length === 0) {
            continue;
        }
        lines.push("", `${kind} (${group.length})`);
        for (const i of group) {
            const from = i.origin ? `from #${i.origin}` : "";
            lines.push(`  #${i.number}  ${i.persona.padEnd(10)} ${from.padEnd(9)}  ${i.title}`);
        }
    }
    return `${lines.join("\n")}\n`;
}

/**
 * Sort the issues the way the list prints them: by kind, then by number.
 *
 * @param {BacklogIssue[]} issues - The issues.
 * @returns {BacklogIssue[]} - A sorted copy.
 */
function ordered(issues) {
    const rank = (/** @type {string} */ k) => KIND_ORDER.indexOf(k);
    return [...issues].sort((a, b) => rank(a.kind) - rank(b.kind) || a.number - b.number);
}

/**
 * Run a command and fail with its stderr when it fails.
 *
 * @param {import("../pipeline/lib/github.js").Runner} run - The runner.
 * @param {string[]} cmd - The command.
 * @returns {Promise<string>} - Its stdout.
 */
async function must(run, cmd) {
    const r = await run(cmd);
    if (r.code !== 0) {
        throw new Error(`${cmd.slice(0, 4).join(" ")}: ${r.stderr.trim()}`);
    }
    return r.stdout;
}

/**
 * Move one issue from the backlog into an epic.
 *
 * @param {import("../pipeline/lib/github.js").Runner} run - The runner.
 * @param {{repo: string, backlog: number, epic: number, stage: string | undefined, n: string}} move - The move.
 * @returns {Promise<void>}
 */
async function moveOne(run, {repo, backlog, epic, stage, n}) {
    const issue = JSON.parse(await must(run, ["gh", "api", `repos/${repo}/issues/${n}`]));
    const body = String(issue.body ?? "");
    const line = `Part of #${epic}`;
    const next = /^Part of #\d+\b.*$/m.test(body)
        ? body.replace(/^Part of #\d+\b.*$/m, line)
        : `${body.trimEnd()}\n\n${line}`;
    const labels = (issue.labels ?? []).map((/** @type {any} */ l) => l.name);
    const edit = ["gh-as", "-", "issue", "edit", n, "-R", repo, "--body", next];
    // With --stage, the old stage label goes too: an issue has one stage label at a time.
    const dropped = (/** @type {string} */ l) =>
        l === "idea" || l === "triage" || (Boolean(stage) && l.startsWith("stage:"));
    for (const name of labels.filter(dropped)) {
        edit.push("--remove-label", name);
    }
    if (stage) {
        edit.push("--add-label", `stage:${stage}`);
    }
    await must(run, edit);
    const id = `sub_issue_id=${issue.id}`;
    // A missing link is not an error: the issue may never have been linked.
    await run([
        "gh-as",
        "-",
        "api",
        "-X",
        "DELETE",
        `repos/${repo}/issues/${backlog}/sub_issue`,
        "-F",
        id
    ]);
    await must(run, [
        "gh-as",
        "-",
        "api",
        "-X",
        "POST",
        `repos/${repo}/issues/${epic}/sub_issues`,
        "-F",
        id,
        // Moves the link from whatever parent it has; a rerun after a failed POST recovers.
        "-F",
        "replace_parent=true"
    ]);
}

/**
 * @typedef {object} CommandContext
 * @property {import("../pipeline/lib/github.js").Runner} run - The command runner.
 * @property {(text: string) => void} out - Standard output.
 * @property {string} repo - The repository.
 * @property {number} backlog - The backlog epic.
 * @property {{json?: boolean, epic?: string, stage?: string, reason?: string}} values - The options.
 * @property {string[]} numbers - The issue numbers given.
 * @property {(why: string) => number} usage - Prints the usage; returns the exit status.
 */

/**
 * `list`: the open issues of the backlog, as text or JSON.
 *
 * @param {CommandContext} ctx - The command context.
 * @returns {Promise<number>} - The exit status.
 */
async function listCommand({run, out, repo, backlog, values, numbers, usage}) {
    if (numbers.length > 0) {
        return usage("list takes no issue numbers");
    }
    // --slurp: with --paginate, gh prints one array per page otherwise.
    const pages = JSON.parse(
        (await must(run, [
            "gh",
            "api",
            "--paginate",
            "--slurp",
            `repos/${repo}/issues/${backlog}/sub_issues`
        ])) || "[]"
    );
    const issues = ordered(
        pages
            .flat()
            .filter((/** @type {any} */ i) => i.state === "open")
            .map(describeIssue)
    );
    out(values.json ? `${JSON.stringify(issues, null, 2)}\n` : listText(backlog, issues));
    return 0;
}

/**
 * `move`: each issue into an epic, with `stage:todo` when asked.
 *
 * @param {CommandContext} ctx - The command context.
 * @returns {Promise<number>} - The exit status.
 */
async function moveCommand({run, out, repo, backlog, values, numbers, usage}) {
    if (numbers.length === 0 || !/^\d+$/.test(values.epic ?? "")) {
        return usage("move needs issue numbers and --epic <#>");
    }
    if (values.stage !== undefined && values.stage !== "todo") {
        return usage("--stage takes only todo");
    }
    for (const n of numbers) {
        await moveOne(run, {repo, backlog, epic: Number(values.epic), stage: values.stage, n});
        out(`#${n} → #${values.epic}${values.stage ? " stage:todo" : ""}\n`);
    }
    return 0;
}

/**
 * `close`: each issue closed as not planned, with the reason as a comment.
 *
 * @param {CommandContext} ctx - The command context.
 * @returns {Promise<number>} - The exit status.
 */
async function closeCommand({run, out, repo, values, numbers, usage}) {
    if (numbers.length === 0 || !values.reason) {
        return usage('close needs issue numbers and --reason "<why>"');
    }
    for (const n of numbers) {
        const comment = `Triaged by Tim: ${values.reason}`;
        await must(run, [
            "gh-as",
            "-",
            "issue",
            "close",
            n,
            "-R",
            repo,
            "--reason",
            "not planned",
            "--comment",
            comment
        ]);
        out(`#${n} closed\n`);
    }
    return 0;
}

/**
 * The command line.
 *
 * @param {string[]} argv - The arguments after the script.
 * @param {object} [deps] - The outside world.
 * @param {Record<string, string | undefined>} [deps.env] - The environment.
 * @param {string} [deps.root] - The repository root, for pipeline/config.
 * @param {import("../pipeline/lib/github.js").Runner} [deps.run] - The command runner.
 * @param {(text: string) => void} [deps.out] - Standard output.
 * @param {(text: string) => void} [deps.err] - Standard error.
 * @returns {Promise<number>} - The exit status.
 */
export async function main(
    argv,
    {
        env = process.env,
        root = new URL("..", import.meta.url).pathname,
        run = defaultRun,
        out = t => process.stdout.write(t),
        err = t => process.stderr.write(t)
    } = {}
) {
    const usage = (/** @type {string} */ why) => {
        err(`${why ? `${why}\n` : ""}${USAGE.join("\n")}\n`);
        return 2;
    };
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                json: {type: "boolean"},
                epic: {type: "string"},
                stage: {type: "string"},
                reason: {type: "string"}
            }
        });
    } catch (error) {
        return usage(error instanceof Error ? error.message : String(error));
    }
    const [command, ...numbers] = parsed.positionals;
    const {values} = parsed;
    const settings = loadConfig({root, env});
    const backlog = Number(env.PIPELINE_BACKLOG || settings.backlog || 0);
    if (!backlog) {
        return usage("PIPELINE_BACKLOG names no backlog epic");
    }
    const repo = settings.repo;
    if (numbers.some(n => !/^\d+$/.test(n))) {
        return usage("issue numbers only");
    }
    const ctx = {run, out, repo, backlog, values, numbers, usage};
    const handler = {list: listCommand, move: moveCommand, close: closeCommand}[command ?? ""];
    return handler ? handler(ctx) : usage("");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    main(process.argv.slice(2)).then(
        code => process.exit(code),
        error => {
            process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
            process.exit(1);
        }
    );
}
