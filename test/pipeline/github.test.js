/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {createGithub, RateLimited, blockedBy, defaultRun} from "../../pipeline/lib/github.js";

/** @type {{cmd: string[], opts: any}[]} */
const calls = [];

/**
 * Make a fake runner that replays canned replies and records each call.
 * @param {{code?: number, stdout?: string, stderr?: string}[]} replies - The replies, in order.
 * @returns {(cmd: string[], opts?: any) => Promise<{code: number, stdout: string, stderr: string}>} The runner.
 */
const fake = replies => async (cmd, opts) => {
    calls.push({cmd, opts});
    const r = replies.shift();
    return {code: r?.code ?? 0, stdout: r?.stdout ?? "", stderr: r?.stderr ?? ""};
};

/**
 * Make a Github over a fake runner and clear the call log.
 * @param {{code?: number, stdout?: string, stderr?: string}[]} replies - The replies, in order.
 * @returns {ReturnType<typeof createGithub>} The client.
 */
function make(replies) {
    calls.length = 0;
    return createGithub({repo: "tjlytle/Sozi", run: fake(replies)});
}

const json = value => ({stdout: JSON.stringify(value)});

describe("github", () => {
    test("label edits go out as ops in one call", async () => {
        const gh = make([{}]);
        await gh.label({issue: 25, add: ["stage:review"], remove: ["stage:in-progress"]});
        assert.deepEqual(calls[0].cmd.slice(0, 4), ["gh-as", "ops", "issue", "edit"]);
        assert.ok(calls[0].cmd.includes("--add-label") && calls[0].cmd.includes("--remove-label"));
        assert.ok(calls[0].cmd.includes("tjlytle/Sozi"));
    });
    test("a rate-limit reply becomes RateLimited with a reset time", async () => {
        const gh = make([
            {code: 1, stderr: "HTTP 403: API rate limit exceeded"},
            {stdout: JSON.stringify({resources: {core: {reset: 1800000000}}})}
        ]);
        await assert.rejects(
            gh.labelsOf(25),
            e => e instanceof RateLimited && e.resetAt.getTime() === 1800000000000
        );
    });
    test("a 403 with rate limit budget left is a plain error, not a back-off", async () => {
        const gh = make([
            {code: 1, stderr: "HTTP 403: Resource not accessible by integration"},
            json({
                resources: {
                    core: {remaining: 5000, reset: 1800000000},
                    graphql: {remaining: 5000, reset: 1800000000}
                }
            })
        ]);
        await assert.rejects(
            gh.labelsOf(25),
            e =>
                e instanceof Error &&
                !(e instanceof RateLimited) &&
                /not accessible/.test(e.message)
        );
    });
    test("a 403 with the GraphQL budget spent is RateLimited until the later reset", async () => {
        const gh = make([
            {code: 1, stderr: "HTTP 403: Forbidden"},
            json({
                resources: {
                    core: {remaining: 4000, reset: 1800000000},
                    graphql: {remaining: 0, reset: 1800000600}
                }
            })
        ]);
        await assert.rejects(
            gh.labelsOf(25),
            e => e instanceof RateLimited && e.resetAt.getTime() === 1800000600000
        );
    });
    test("a 403 whose rate_limit read fails is a plain error", async () => {
        const gh = make([
            {code: 1, stderr: "HTTP 403"},
            {code: 1, stderr: "nope"}
        ]);
        await assert.rejects(gh.labelsOf(25), e => !(e instanceof RateLimited));
    });
    test("Blocked by lines are read from a plan", () => {
        assert.deepEqual(blockedBy("## Implementation Plan\n...\nBlocked by #28, #26\n"), [28, 26]);
        assert.deepEqual(blockedBy("no line"), []);
    });
    test("the newest human comment wakes a parked issue", async () => {
        const gh = make([
            json([
                [
                    {user: {login: "ll-ops[bot]", type: "Bot"}},
                    {user: {login: "tjlytle", type: "User"}}
                ]
            ])
        ]);
        assert.equal(await gh.lastCommentIsHuman(25), true);
    });

    test("blockedBy dedupes and ignores later lines", () => {
        assert.deepEqual(blockedBy("Blocked by #3 #4, #3\nBlocked by #9"), [3, 4]);
    });

    test("searchIssues without since lists open issues only and flattens labels", async () => {
        const gh = make([
            json([
                {
                    number: 5,
                    title: "T",
                    labels: [{name: "stage:todo"}, {name: "idea"}],
                    body: "B",
                    state: "OPEN",
                    updatedAt: "2026-01-01T00:00:00Z"
                }
            ])
        ]);
        const issues = await gh.searchIssues();
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "issue",
            "list",
            "-R",
            "tjlytle/Sozi",
            "--state",
            "open",
            "--limit",
            "200",
            "--json",
            "number,title,labels,body,state,updatedAt"
        ]);
        assert.deepEqual(issues, [
            {
                number: 5,
                title: "T",
                labels: ["stage:todo", "idea"],
                body: "B",
                state: "OPEN",
                updatedAt: "2026-01-01T00:00:00Z"
            }
        ]);
    });
    test("searchIssues with since adds a closed query and dedupes by number", async () => {
        const open = {number: 5, title: "a", labels: [], body: "", state: "OPEN", updatedAt: "x"};
        const closed = {
            number: 6,
            title: "b",
            labels: [{name: "stage:done"}],
            body: "",
            state: "CLOSED",
            updatedAt: "y"
        };
        const gh = make([json([open]), json([{...open, title: "dup"}, closed])]);
        const issues = await gh.searchIssues({since: "2026-01-01T00:00:00Z"});
        assert.deepEqual(calls[1].cmd, [
            "gh-as",
            "ops",
            "issue",
            "list",
            "-R",
            "tjlytle/Sozi",
            "--state",
            "closed",
            "--limit",
            "200",
            "--search",
            "updated:>=2026-01-01T00:00:00Z",
            "--json",
            "number,title,labels,body,state,updatedAt"
        ]);
        assert.deepEqual(
            issues.map(i => [i.number, i.title, i.state]),
            [
                [5, "a", "OPEN"],
                [6, "b", "CLOSED"]
            ]
        );
    });

    test("labelsOf returns label names", async () => {
        const gh = make([json({labels: [{name: "a"}, {name: "b"}]})]);
        assert.deepEqual(await gh.labelsOf(7), ["a", "b"]);
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "issue",
            "view",
            "7",
            "-R",
            "tjlytle/Sozi",
            "--json",
            "labels"
        ]);
    });

    test("label with add only", async () => {
        const gh = make([{}]);
        await gh.label({issue: 3, add: ["a", "b"], remove: []});
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "issue",
            "edit",
            "3",
            "-R",
            "tjlytle/Sozi",
            "--add-label",
            "a,b"
        ]);
    });
    test("label with remove only", async () => {
        const gh = make([{}]);
        await gh.label({issue: 3, remove: ["c"]});
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "issue",
            "edit",
            "3",
            "-R",
            "tjlytle/Sozi",
            "--remove-label",
            "c"
        ]);
    });
    test("label with both", async () => {
        const gh = make([{}]);
        await gh.label({issue: 3, add: ["a"], remove: ["c", "d"]});
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "issue",
            "edit",
            "3",
            "-R",
            "tjlytle/Sozi",
            "--add-label",
            "a",
            "--remove-label",
            "c,d"
        ]);
    });
    test("label with neither makes no call", async () => {
        const gh = make([]);
        await gh.label({issue: 3, add: [], remove: []});
        assert.equal(calls.length, 0);
    });

    test("comment sends the body on stdin as the persona", async () => {
        const gh = make([{}]);
        await gh.comment("qa", 9, 'it\'s `weird` $(x)\n"quoted"');
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "qa",
            "issue",
            "comment",
            "9",
            "-R",
            "tjlytle/Sozi",
            "--body-file",
            "-"
        ]);
        assert.equal(calls[0].opts.input, 'it\'s `weird` $(x)\n"quoted"');
    });

    test("lastCommentIsHuman is false for a bot and for no comments", async () => {
        let gh = make([json([[{user: {type: "User"}}, {user: {type: "Bot"}}]])]);
        assert.equal(await gh.lastCommentIsHuman(4), false);
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "api",
            "--paginate",
            "--slurp",
            "repos/tjlytle/Sozi/issues/4/comments?per_page=100"
        ]);
        gh = make([json([[]])]);
        assert.equal(await gh.lastCommentIsHuman(4), false);
    });

    test("lastHumanCommentAt gives the time of a newest comment by a person, else null", async () => {
        let gh = make([
            json([
                [{user: {type: "Bot"}}, {user: {type: "User"}, created_at: "2026-10-21T10:00:00Z"}]
            ])
        ]);
        assert.equal(await gh.lastHumanCommentAt(4), "2026-10-21T10:00:00Z");
        gh = make([json([[{user: {type: "User"}, created_at: "x"}, {user: {type: "Bot"}}]])]);
        assert.equal(await gh.lastHumanCommentAt(4), null);
    });

    test("planComment returns the newest plan body", async () => {
        const gh = make([
            json([
                {body: "**Implementation Plan**\nold"},
                {body: "chatter"},
                {body: "  ## Implementation Plan\nnew  "},
                {body: "more chatter"}
            ])
        ]);
        assert.equal(await gh.planComment(8), "## Implementation Plan\nnew");
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "api",
            "--paginate",
            "--slurp",
            "repos/tjlytle/Sozi/issues/8/comments?per_page=100"
        ]);
    });
    test("planComment is null when there is none", async () => {
        const gh = make([json([[{body: "hello"}]])]);
        assert.equal(await gh.planComment(8), null);
    });

    test("openPrFor finds the PR that closes the issue", async () => {
        const gh = make([
            json([
                {number: 40, headRefName: "x", body: "Closes #125"},
                {number: 41, headRefName: "issue-12", body: "text\nFixes #12"}
            ])
        ]);
        assert.deepEqual(await gh.openPrFor(12), {number: 41, headRefName: "issue-12"});
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "pr",
            "list",
            "-R",
            "tjlytle/Sozi",
            "--state",
            "open",
            "--limit",
            "100",
            "--search",
            "12 in:body",
            "--json",
            "number,headRefName,body"
        ]);
    });
    test("openPrFor is null when no PR closes it", async () => {
        const gh = make([json([{number: 40, headRefName: "x", body: "Mentions #12"}])]);
        assert.equal(await gh.openPrFor(12), null);
    });

    test("openPrFor accepts every closing keyword, any case", async () => {
        for (const kw of ["Close", "closed", "FIX", "Fixed", "resolve", "Resolved"]) {
            const gh = make([json([{number: 3, headRefName: "b", body: `${kw} #12`}])]);
            assert.equal((await gh.openPrFor(12))?.number, 3, kw);
        }
    });

    test("comments are read across every page and the newest overall decides", async () => {
        const gh = make([
            json([[{user: {type: "Bot"}}], [{user: {type: "Bot"}}, {user: {type: "User"}}]])
        ]);
        assert.equal(await gh.lastCommentIsHuman(4), true);
        const gh2 = make([
            json([
                [{body: "## Implementation Plan\nold"}],
                [{body: "**Implementation Plan**\nnew"}]
            ])
        ]);
        assert.equal(await gh2.planComment(4), "**Implementation Plan**\nnew");
    });

    test("defaultRun delivers stdin, captures stderr and resolves a non-zero code", async () => {
        const script =
            "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{process.stdout.write(d);process.stderr.write('err');process.exit(3)})";
        const r = await defaultRun([process.execPath, "-e", script], {input: "hello"});
        assert.deepEqual(r, {code: 3, stdout: "hello", stderr: "err"});
    });
    test("defaultRun resolves a missing binary with a non-zero code and the error", async () => {
        const r = await defaultRun(["/nonexistent/binary"]);
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /ENOENT|nonexistent/);
    });

    test("a plain failure names the command and carries stderr", async () => {
        const gh = make([{code: 1, stderr: "boom"}]);
        await assert.rejects(
            gh.labelsOf(7),
            (/** @type {Error} */ e) =>
                !(e instanceof RateLimited) &&
                /gh-as ops issue view/.test(e.message) &&
                /boom/.test(e.message)
        );
    });
    test("bad JSON is an error naming the command", async () => {
        const gh = make([{stdout: "not json"}]);
        await assert.rejects(
            gh.labelsOf(7),
            e => e instanceof Error && /gh-as ops issue view/.test(e.message)
        );
    });
    test("rate limit without a working rate_limit call falls back to 15 minutes", async () => {
        const gh = make([
            {code: 1, stderr: "HTTP 429"},
            {code: 1, stderr: "nope"}
        ]);
        const before = Date.now();
        await assert.rejects(
            gh.labelsOf(7),
            e =>
                e instanceof RateLimited &&
                e.resetAt.getTime() - before >= 15 * 60000 - 1000 &&
                e.resetAt.getTime() - before <= 15 * 60000 + 5000
        );
        assert.deepEqual(calls[1].cmd, ["gh-as", "ops", "api", "rate_limit"]);
    });
});
