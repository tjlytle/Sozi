/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {linkSubIssues} from "../../pipeline/lib/subissues.js";
import {RateLimited} from "../../pipeline/lib/github.js";
import {emptyState, applyIssue} from "../../pipeline/lib/state.js";

const NOW = Date.parse("2026-10-23T12:00:00Z");

/**
 * An issue as GitHub has it, with an optional `Part of` line.
 * @param {number} number - The issue number.
 * @param {number | null} epic - The epic of its `Part of` line, or null for none.
 * @returns {any} The issue.
 */
const issue = (number, epic) => ({
    number,
    title: `t${number}`,
    labels: [],
    state: "OPEN",
    body: epic === null ? "Some text." : `Some text.\n\nPart of #${epic}`
});

/**
 * A pass context over a fake GitHub that records each call; a reply from `fail` for a
 * method is thrown once, in order.
 * @param {{parents?: Record<number, number | null>, fail?: Record<string, Error[]>}} [options] - The parents GitHub reports and the errors to throw.
 * @returns {any} The context, with `calls` and `logs`.
 */
function context({parents = {}, fail = {}} = {}) {
    /** @type {any[]} */
    const calls = [];
    /** @type {string[]} */
    const logs = [];
    /**
     * Record a call, then throw the next queued error for the method, if any.
     * @param {string} name - The method.
     * @param {number[]} args - Its arguments.
     */
    const record = (name, args) => {
        calls.push([name, ...args]);
        const error = fail[name]?.shift();
        if (error) {
            throw error;
        }
    };
    const github = {
        parentOf: async (/** @type {number} */ n) => {
            record("parentOf", [n]);
            return parents[n] ?? null;
        },
        linkSubIssue: async (/** @type {number} */ epic, /** @type {number} */ n) =>
            record("linkSubIssue", [epic, n]),
        unlinkSubIssue: async (/** @type {number} */ epic, /** @type {number} */ n) =>
            record("unlinkSubIssue", [epic, n])
    };
    return {
        state: emptyState(),
        github,
        clock: {now: () => NOW},
        log: (/** @type {string} */ line) => logs.push(line),
        calls,
        logs
    };
}

describe("subissues", () => {
    test("a new Part of line reads the parent once, links the issue and records it", async () => {
        const ctx = context();
        applyIssue(ctx.state, issue(120, 93));
        await linkSubIssues(ctx);
        assert.deepEqual(ctx.calls, [
            ["parentOf", 120],
            ["linkSubIssue", 93, 120]
        ]);
        assert.equal(ctx.state.issues[120].linked, 93);
    });
    test("reading the same issue again makes no call", async () => {
        const ctx = context();
        applyIssue(ctx.state, issue(120, 93));
        await linkSubIssues(ctx);
        ctx.calls.length = 0;
        applyIssue(ctx.state, issue(120, 93));
        await linkSubIssues(ctx);
        assert.deepEqual(ctx.calls, []);
    });
    test("an issue already under its epic, linked by hand, gets no link call", async () => {
        const ctx = context({parents: {120: 93}});
        applyIssue(ctx.state, issue(120, 93));
        await linkSubIssues(ctx);
        assert.deepEqual(ctx.calls, [["parentOf", 120]]);
        assert.equal(ctx.state.issues[120].linked, 93);
    });
    test("an issue with no Part of line and no parent makes one read and no write", async () => {
        const ctx = context();
        applyIssue(ctx.state, issue(120, null));
        await linkSubIssues(ctx);
        assert.deepEqual(ctx.calls, [["parentOf", 120]]);
        assert.equal(ctx.state.issues[120].linked, null);
    });
    test("a Part of line that changes epic moves the issue with one link call", async () => {
        const ctx = context();
        applyIssue(ctx.state, issue(120, 93));
        await linkSubIssues(ctx);
        ctx.calls.length = 0;
        applyIssue(ctx.state, issue(120, 123));
        await linkSubIssues(ctx);
        assert.deepEqual(ctx.calls, [["linkSubIssue", 123, 120]]);
        assert.equal(ctx.state.issues[120].linked, 123);
    });
    test("a removed Part of line unlinks the issue from its old epic", async () => {
        const ctx = context();
        applyIssue(ctx.state, issue(120, 93));
        await linkSubIssues(ctx);
        ctx.calls.length = 0;
        applyIssue(ctx.state, issue(120, null));
        await linkSubIssues(ctx);
        assert.deepEqual(ctx.calls, [["unlinkSubIssue", 93, 120]]);
        assert.equal(ctx.state.issues[120].linked, null);
    });
    test("a failed link is logged, keeps the old link and is tried again next sync", async () => {
        const ctx = context({fail: {linkSubIssue: [new Error("boom")]}});
        applyIssue(ctx.state, issue(120, 93));
        await linkSubIssues(ctx);
        assert.equal(ctx.state.issues[120].linked, null);
        assert.ok(ctx.logs.some(l => /^#120: sub-issue link failed: .*boom/.test(l)));
        ctx.calls.length = 0;
        await linkSubIssues(ctx);
        assert.deepEqual(ctx.calls, [["linkSubIssue", 93, 120]]);
        assert.equal(ctx.state.issues[120].linked, 93);
    });
    test("a rate limit stops the walk and reaches the caller", async () => {
        const ctx = context({
            fail: {linkSubIssue: [new RateLimited("limit", new Date(NOW + 60000))]}
        });
        applyIssue(ctx.state, issue(120, 93));
        applyIssue(ctx.state, issue(121, 93));
        await assert.rejects(linkSubIssues(ctx), RateLimited);
        assert.deepEqual(ctx.calls, [
            ["parentOf", 120],
            ["linkSubIssue", 93, 120]
        ]);
        assert.equal(ctx.state.issues[120].linked, null);
        assert.equal(ctx.state.issues[121].linked, undefined);
    });
});
