// test/pipeline/usage-comment.test.js: the usage comment ops posts when a session ends.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    formatDuration,
    formatTokens,
    formatTurns,
    usageComment
} from "../../pipeline/lib/usage-comment.js";

/**
 * The fields of the issue's example session, with some replaced.
 *
 * @param {Record<string, any>} [extra] - Fields to replace.
 * @returns {any} The fields usageComment takes.
 */
function fields(extra = {}) {
    return {
        stage: "build",
        try: 1,
        persona: "builder",
        harness: "codex",
        model: "gpt-6.1-sol",
        result: {
            exit: 0,
            session: "s",
            usage: {
                tokensIn: 12034,
                cacheRead: 180200,
                cacheWrite: 9933,
                tokensOut: 10120,
                costUsd: 0,
                turns: 41,
                status: "ok"
            },
            usageKnown: true,
            changed: [],
            commits: [],
            resumes: 2,
            hooks: "ok"
        },
        startedAt: "2026-10-23T15:15:00.000Z",
        endedAt: "2026-10-23T15:33:04.000Z",
        outcome: "exited",
        outbox: "/srv/var/pipeline/out-120-build-20261023-1515",
        ...extra
    };
}

const EXAMPLE = `<details>
<summary>⏱ build · codex gpt-6.1-sol · 212k tokens · 41 turns · 18m · ok</summary>

| | |
|---|---|
| Stage | build (try 1) |
| Harness / model | codex / gpt-6.1-sol |
| Tokens | in 12,034 · cache read 180,200 · cache write 9,933 · out 10,120 |
| Turns | 41 (2 resumes) |
| Wall time | 18m 04s |
| Cost (notional) | $0.00 |
| Result | ok · exit 0 · hooks ok |
| Outbox | out-120-build-20261023-1515 |
</details>`;

/**
 * The value of a table row of a comment.
 *
 * @param {string} comment - The comment.
 * @param {string} name - The row name.
 * @returns {string | undefined} The value.
 */
function row(comment, name) {
    const line = comment.split("\n").find(l => l.startsWith(`| ${name} |`));
    return line?.slice(`| ${name} | `.length, -" |".length);
}

describe("the usage comment", () => {
    test("renders the issue's example byte for byte", () => {
        assert.equal(usageComment(fields()), EXAMPLE);
    });
    test("shows nothing outside <details> but the summary", () => {
        const comment = usageComment(fields());
        assert.ok(comment.startsWith("<details>\n<summary>"));
        assert.ok(comment.endsWith("</details>"));
        assert.equal(comment.match(/<details>/g)?.length, 1);
    });
    test("a spawned session names its persona as the stage, without a try", () => {
        const comment = usageComment(fields({stage: "spawn", try: null, persona: "advocate"}));
        assert.match(comment, /<summary>⏱ spawn \(advocate\) · codex/);
        assert.equal(row(comment, "Stage"), "spawn (advocate)");
    });
    test("no result: counts, turns and status are unknown, and so are exit and hooks", () => {
        const comment = usageComment(fields({result: null}));
        assert.match(
            comment,
            /<summary>⏱ build · codex gpt-6.1-sol · unknown tokens · unknown turns · 18m · unknown<\/summary>/
        );
        assert.equal(row(comment, "Tokens"), "unknown");
        assert.equal(row(comment, "Turns"), "unknown");
        assert.equal(row(comment, "Cost (notional)"), "unknown");
        assert.equal(row(comment, "Result"), "unknown");
    });
    test("no usage.json: the counts and status are unknown, the exit and hooks show", () => {
        const result = {...fields().result, exit: 1, hooks: "skipped", usageKnown: false};
        const comment = usageComment(fields({result}));
        assert.match(comment, /· unknown tokens · unknown turns · 18m · unknown<\/summary>/);
        assert.equal(row(comment, "Tokens"), "unknown");
        assert.equal(row(comment, "Result"), "unknown · exit 1 · hooks skipped");
    });
    test("a session stopped at the cap, or whose container went, says so", () => {
        const overdue = usageComment(fields({outcome: "overdue"}));
        assert.equal(
            row(overdue, "Result"),
            "ok · exit 0 · hooks ok · stopped at the wall-clock cap"
        );
        const gone = usageComment(fields({outcome: "gone"}));
        assert.equal(row(gone, "Result"), "ok · exit 0 · hooks ok · container gone");
    });
    test("the cost has two decimals", () => {
        const result = fields().result;
        const comment = usageComment(
            fields({result: {...result, usage: {...result.usage, costUsd: 1.234}}})
        );
        assert.equal(row(comment, "Cost (notional)"), "$1.23");
    });
});

describe("formats", () => {
    test("tokens: as is under a thousand, k under a million, M with one decimal past it", () => {
        assert.equal(formatTokens(812), "812");
        assert.equal(formatTokens(212287), "212k");
        assert.equal(formatTokens(999700), "1.0M");
        assert.equal(formatTokens(1400000), "1.4M");
    });
    test("duration: minutes in the summary, seconds in the table, hours past an hour", () => {
        assert.equal(formatDuration(1084, "summary"), "18m");
        assert.equal(formatDuration(1084, "table"), "18m 04s");
        assert.equal(formatDuration(45, "summary"), "45s");
        assert.equal(formatDuration(45, "table"), "45s");
        assert.equal(formatDuration(3900, "summary"), "1h 05m");
        assert.equal(formatDuration(3900, "table"), "1h 05m");
    });
    test("turns: the resumes in brackets, singular for one", () => {
        assert.equal(formatTurns(41, 0), "41");
        assert.equal(formatTurns(41, 1), "41 (1 resume)");
        assert.equal(formatTurns(41, 2), "41 (2 resumes)");
    });
});
