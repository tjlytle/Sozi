/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {blockedBy} from "../../pipeline/lib/github.js";
import {calls, json, make} from "./github-world.js";

describe("github", () => {
    test("label edits go out as ops in one call", async () => {
        const gh = make([{}]);
        await gh.label({issue: 25, add: ["stage:review"], remove: ["stage:in-progress"]});
        assert.deepEqual(calls[0].cmd.slice(0, 4), ["gh-as", "ops", "issue", "edit"]);
        assert.ok(calls[0].cmd.includes("--add-label") && calls[0].cmd.includes("--remove-label"));
        assert.ok(calls[0].cmd.includes("tjlytle/Sozi"));
    });
    test("issueBody reads the body as ops", async () => {
        const gh = make([json({body: "Part of #123"})]);
        assert.equal(await gh.issueBody(25), "Part of #123");
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "issue",
            "view",
            "25",
            "-R",
            "tjlytle/Sozi",
            "--json",
            "body"
        ]);
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
    test("parentOf reads the parent issue as ops and gives its number", async () => {
        const gh = make([json({number: 93})]);
        assert.equal(await gh.parentOf(120), 93);
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "api",
            "repos/tjlytle/Sozi/issues/120/parent"
        ]);
    });
    test("parentOf gives null when GitHub says the issue has no parent", async () => {
        const gh = make([{code: 1, stderr: "gh: Not Found (HTTP 404)"}]);
        assert.equal(await gh.parentOf(120), null);
    });
    test("linkSubIssue reads the child's id, then links it, replacing an old parent", async () => {
        const gh = make([{stdout: "3456789\n"}, {}]);
        await gh.linkSubIssue(93, 120);
        assert.deepEqual(calls[0].cmd, [
            "gh-as",
            "ops",
            "api",
            "repos/tjlytle/Sozi/issues/120",
            "--jq",
            ".id"
        ]);
        assert.deepEqual(calls[1].cmd, [
            "gh-as",
            "ops",
            "api",
            "-X",
            "POST",
            "repos/tjlytle/Sozi/issues/93/sub_issues",
            "-F",
            "sub_issue_id=3456789",
            "-F",
            "replace_parent=true"
        ]);
    });
    test("unlinkSubIssue reads the child's id, then removes it from the epic", async () => {
        const gh = make([{stdout: "3456789\n"}, {}]);
        await gh.unlinkSubIssue(93, 120);
        assert.deepEqual(calls[1].cmd, [
            "gh-as",
            "ops",
            "api",
            "-X",
            "DELETE",
            "repos/tjlytle/Sozi/issues/93/sub_issue",
            "-F",
            "sub_issue_id=3456789"
        ]);
    });
});
