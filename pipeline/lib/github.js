/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Every GitHub read and write the loop makes, through `gh-as ops` of the
// gh-personas plugin. The runner is injectable so tests never touch the network.

import {execFile} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RATE_LIMIT = /rate limit|\b429\b/i;
const FORBIDDEN = /\b403\b/;
const NOT_FOUND = /\b404\b/;
const BACKOFF_MS = 15 * 60 * 1000;
const ISSUE_FIELDS = "number,title,labels,body,state,updatedAt";

/**
 * @typedef {object} RunResult
 * @property {number} code - The exit code.
 * @property {string} stdout - Captured standard output.
 * @property {string} stderr - Captured standard error.
 */

/**
 * @typedef {(cmd: string[], opts?: {input?: string, env?: Record<string, string>}) => Promise<RunResult>} Runner
 */

/**
 * @typedef {object} Issue
 * @property {number} number - The issue number.
 * @property {string} title - The title.
 * @property {string[]} labels - Label names.
 * @property {string} body - The body text.
 * @property {"OPEN"|"CLOSED"} state - The state.
 * @property {string} updatedAt - ISO time of the last update.
 */

/**
 * @typedef {object} Github
 * @property {(opts?: {since?: string}) => Promise<Issue[]>} searchIssues - Open issues, plus closed ones updated since.
 * @property {(n: number) => Promise<string[]>} labelsOf - Label names of an issue.
 * @property {(opts: {issue: number, add?: string[], remove?: string[]}) => Promise<void>} label - Edit labels in one call.
 * @property {(persona: string, n: number, body: string) => Promise<void>} comment - Comment as a persona.
 * @property {(n: number) => Promise<boolean>} lastCommentIsHuman - Whether the newest comment is from a user.
 * @property {(n: number) => Promise<string|null>} lastHumanCommentAt - When the newest comment was written, if a user wrote it.
 * @property {(n: number) => Promise<string|null>} planComment - The newest implementation plan comment body.
 * @property {(n: number) => Promise<{number: number, headRefName: string}|null>} openPrFor - The open PR that closes the issue.
 * @property {(n: number) => Promise<number|null>} parentOf - The issue's parent (its epic as a sub-issue), or null when it has none.
 * @property {(epic: number, n: number) => Promise<void>} linkSubIssue - Make the issue a sub-issue of the epic, moving it from any other parent.
 * @property {(epic: number, n: number) => Promise<void>} unlinkSubIssue - Remove the issue from the epic's sub-issues.
 */

/**
 * Thrown when GitHub says the rate limit is hit.
 */
export class RateLimited extends Error {
    /**
     * Create the error.
     * @param {string} message - What was rate limited.
     * @param {Date} resetAt - When to try again.
     */
    constructor(message, resetAt) {
        super(message);
        this.name = "RateLimited";
        this.resetAt = resetAt;
    }
}

/**
 * Find the directories that hold gh-as.
 * @returns {string[]} The plugin bin directories.
 */
function pluginBins() {
    const root = path.join(os.homedir(), ".claude", "plugins", "cache", "dev-flow", "gh-personas");
    try {
        return fs
            .readdirSync(root)
            .map(v => path.join(root, v, "bin"))
            .filter(d => fs.existsSync(d));
    } catch {
        return [];
    }
}

/**
 * Run a command with execFile (no shell), with the gh-personas bin on PATH.
 * @param {string[]} cmd - The command and arguments.
 * @param {{input?: string, env?: Record<string, string>}} [opts] - Optional standard input and variables added to the environment.
 * @returns {Promise<RunResult>} The result; never rejects on a non-zero exit.
 */
export function defaultRun(cmd, opts = {}) {
    const PATH = [...pluginBins(), process.env.PATH ?? ""].join(path.delimiter);
    return new Promise(resolve => {
        const child = execFile(
            cmd[0],
            cmd.slice(1),
            {env: {...process.env, ...opts.env, PATH}, maxBuffer: 64 * 1024 * 1024},
            (error, stdout, stderr) => {
                /** @type {any} */
                const e = error;
                const code = e ? (typeof e.code === "number" ? e.code : 1) : 0;
                resolve({
                    code,
                    stdout,
                    stderr: e && typeof e.code !== "number" ? `${stderr}${e.message}` : stderr
                });
            }
        );
        if (opts.input !== undefined) {
            child.stdin?.on("error", () => {});
            child.stdin?.end(opts.input);
        }
    });
}

/**
 * Read the issue numbers of the first "Blocked by" line.
 * @param {string} text - A plan or issue body.
 * @returns {number[]} The blocking issue numbers, in order, without duplicates.
 */
export function blockedBy(text) {
    const m = /^Blocked by\s+((?:#\d+[,\s]*)+)/m.exec(text ?? "");
    if (!m) {
        return [];
    }
    return [...new Set([...m[1].matchAll(/#(\d+)/g)].map(x => Number(x[1])))];
}

/**
 * Create a GitHub client that acts as the ops persona.
 * @param {{repo: string, run?: Runner}} options - The repository (owner/name) and an optional runner.
 * @returns {Github} The client.
 */
export function createGithub({repo, run = defaultRun}) {
    /**
     * Read the rate limit budgets: whether core or GraphQL is spent, and the later reset.
     * @returns {Promise<{spent: boolean, resetAt: Date | null}>} What GitHub says; nothing spent when it cannot say.
     */
    async function budget() {
        try {
            const lim = await run(["gh-as", "ops", "api", "rate_limit"]);
            const resources = lim.code === 0 ? JSON.parse(lim.stdout)?.resources : null;
            const both = [resources?.core, resources?.graphql].filter(Boolean);
            const resets = both.map(r => r.reset).filter(r => typeof r === "number");
            return {
                spent: both.some(r => r.remaining === 0),
                resetAt: resets.length ? new Date(Math.max(...resets) * 1000) : null
            };
        } catch {
            return {spent: false, resetAt: null};
        }
    }

    /**
     * Build the error for a command that failed: RateLimited when the reply says so, or
     * when a 403 comes with a spent core or GraphQL budget; a plain Error otherwise, for
     * the dead-letter path.
     * @param {string[]} cmd - The command.
     * @param {RunResult} r - Its result.
     * @returns {Promise<Error>} RateLimited or a plain Error.
     */
    async function failure(cmd, r) {
        const name = cmd.slice(0, 4).join(" ");
        const said = RATE_LIMIT.test(r.stderr);
        if (said || FORBIDDEN.test(r.stderr)) {
            const {spent, resetAt} = await budget();
            if (said || spent) {
                return new RateLimited(
                    `${name}: ${r.stderr.trim()}`,
                    resetAt ?? new Date(Date.now() + BACKOFF_MS)
                );
            }
        }
        return new Error(`${name} failed (${r.code}): ${r.stderr.trim()}`);
    }

    /**
     * Run a command, throwing on any failure.
     * @param {string[]} cmd - The command.
     * @param {{input?: string}} [opts] - Optional standard input.
     * @returns {Promise<string>} Standard output.
     */
    async function exec(cmd, opts) {
        const r = await run(cmd, opts);
        if (r.code !== 0) {
            throw await failure(cmd, r);
        }
        return r.stdout;
    }

    /**
     * Run a command and parse its standard output as JSON.
     * @param {string[]} cmd - The command.
     * @returns {Promise<any>} The parsed value.
     */
    async function json(cmd) {
        const out = await exec(cmd);
        try {
            return JSON.parse(out);
        } catch (e) {
            throw new Error(
                `${cmd.slice(0, 4).join(" ")}: invalid JSON from gh (${/** @type {Error} */ (e).message})`
            );
        }
    }

    /**
     * List issues in one state.
     * @param {string[]} extra - Extra gh arguments.
     * @returns {Promise<Issue[]>} The normalised issues.
     */
    async function list(extra) {
        const rows = await json([
            "gh-as",
            "ops",
            "issue",
            "list",
            "-R",
            repo,
            ...extra,
            "--json",
            ISSUE_FIELDS
        ]);
        return rows.map((/** @type {any} */ r) => ({
            number: r.number,
            title: r.title,
            labels: (r.labels ?? []).map((/** @type {any} */ l) => l.name),
            body: r.body ?? "",
            state: r.state,
            updatedAt: r.updatedAt
        }));
    }

    /**
     * Fetch the comments of an issue.
     * @param {number} n - The issue number.
     * @returns {Promise<any[]>} The comments, oldest first.
     */
    async function comments(n) {
        const pages = await json([
            "gh-as",
            "ops",
            "api",
            "--paginate",
            "--slurp",
            `repos/${repo}/issues/${n}/comments?per_page=100`
        ]);
        return pages.flat();
    }

    /**
     * Read an issue's database id, which the sub-issue calls name the child by.
     * @param {number} n - The issue number.
     * @returns {Promise<string>} The id.
     */
    async function issueId(n) {
        const out = await exec(["gh-as", "ops", "api", `repos/${repo}/issues/${n}`, "--jq", ".id"]);
        return out.trim();
    }

    return {
        async searchIssues({since} = {}) {
            const issues = await list(["--state", "open", "--limit", "200"]);
            if (since) {
                issues.push(
                    ...(await list([
                        "--state",
                        "closed",
                        "--limit",
                        "200",
                        "--search",
                        `updated:>=${since}`
                    ]))
                );
            }
            const seen = new Map();
            for (const i of issues) {
                if (!seen.has(i.number)) {
                    seen.set(i.number, i);
                }
            }
            return [...seen.values()];
        },
        async labelsOf(n) {
            const v = await json([
                "gh-as",
                "ops",
                "issue",
                "view",
                String(n),
                "-R",
                repo,
                "--json",
                "labels"
            ]);
            return (v.labels ?? []).map((/** @type {any} */ l) => l.name);
        },
        async label({issue, add = [], remove = []}) {
            if (!add.length && !remove.length) {
                return;
            }
            const cmd = ["gh-as", "ops", "issue", "edit", String(issue), "-R", repo];
            if (add.length) {
                cmd.push("--add-label", add.join(","));
            }
            if (remove.length) {
                cmd.push("--remove-label", remove.join(","));
            }
            await exec(cmd);
        },
        async comment(persona, n, body) {
            await exec(
                ["gh-as", persona, "issue", "comment", String(n), "-R", repo, "--body-file", "-"],
                {input: body}
            );
        },
        async lastCommentIsHuman(n) {
            const all = await comments(n);
            return all.length > 0 && all[all.length - 1]?.user?.type === "User";
        },
        async lastHumanCommentAt(n) {
            const all = await comments(n);
            const last = all[all.length - 1];
            return last?.user?.type === "User" ? String(last.created_at ?? "") || null : null;
        },
        async planComment(n) {
            const all = await comments(n);
            for (let i = all.length - 1; i >= 0; i--) {
                const body = String(all[i]?.body ?? "").trim();
                if (
                    body.startsWith("**Implementation Plan**") ||
                    body.startsWith("## Implementation Plan")
                ) {
                    return body;
                }
            }
            return null;
        },
        async openPrFor(n) {
            const prs = await json([
                "gh-as",
                "ops",
                "pr",
                "list",
                "-R",
                repo,
                "--state",
                "open",
                "--limit",
                "100",
                "--search",
                `${n} in:body`,
                "--json",
                "number,headRefName,body"
            ]);
            const re = new RegExp(`\\b(?:Close[sd]?|Fix(?:es|ed)?|Resolve[sd]?)\\s+#${n}\\b`, "i");
            const pr = prs.find((/** @type {any} */ p) => re.test(p.body ?? ""));
            return pr ? {number: pr.number, headRefName: pr.headRefName} : null;
        },
        async parentOf(n) {
            const cmd = ["gh-as", "ops", "api", `repos/${repo}/issues/${n}/parent`];
            const r = await run(cmd);
            if (r.code !== 0) {
                if (NOT_FOUND.test(r.stderr)) {
                    return null;
                }
                throw await failure(cmd, r);
            }
            return JSON.parse(r.stdout).number;
        },
        async linkSubIssue(epic, n) {
            const id = await issueId(n);
            await exec([
                "gh-as",
                "ops",
                "api",
                "-X",
                "POST",
                `repos/${repo}/issues/${epic}/sub_issues`,
                "-F",
                `sub_issue_id=${id}`,
                "-F",
                "replace_parent=true"
            ]);
        },
        async unlinkSubIssue(epic, n) {
            const id = await issueId(n);
            await exec([
                "gh-as",
                "ops",
                "api",
                "-X",
                "DELETE",
                `repos/${repo}/issues/${epic}/sub_issue`,
                "-F",
                `sub_issue_id=${id}`
            ]);
        }
    };
}
