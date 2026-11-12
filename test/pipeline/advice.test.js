// test/pipeline/advice.test.js: the advisor's pure functions: question bounds, prompt, record, rollover.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    MAX_DIFF_BYTES,
    MAX_FAILING_BYTES,
    addAdvisorUsage,
    answerText,
    consultKey,
    consultPrompt,
    contextOf,
    nudgeText,
    parseQuestion,
    recordComment,
    refusal,
    rollsOver
} from "../../pipeline/lib/advice.js";

describe("parseQuestion", () => {
    test("reads the question, stage, diff and failing output", () => {
        const q = parseQuestion(
            JSON.stringify({question: " why? ", stage: "build", issue: 7, diff: "d", failing: "f"}),
            {issue: 7}
        );
        assert.deepEqual(q, {question: "why?", stage: "build", diff: "d", failing: "f"});
    });

    test("fills what is missing with empty text", () => {
        assert.deepEqual(parseQuestion(JSON.stringify({question: "q"}), {issue: 7}), {
            question: "q",
            stage: "",
            diff: "",
            failing: ""
        });
    });

    test("cuts a large diff and failing output with a note", () => {
        const q = parseQuestion(
            JSON.stringify({
                question: "q",
                diff: "x".repeat(MAX_DIFF_BYTES + 10),
                failing: "y".repeat(MAX_FAILING_BYTES + 10)
            }),
            {issue: 7}
        );
        assert.ok(q.diff.startsWith("x".repeat(MAX_DIFF_BYTES)));
        assert.match(q.diff, /\[diff cut to 100 KiB\]$/);
        assert.match(q.failing, /\[failing output cut to 20 KiB\]$/);
    });

    /** @type {[string, string, RegExp][]} */
    const rejects = [
        ["not JSON", "{", /not JSON/],
        ["an array", "[]", /must be an object/],
        ["no question", "{}", /question must be a non-empty string/],
        ["a blank question", JSON.stringify({question: "  "}), /non-empty/],
        ["a long question", JSON.stringify({question: "q".repeat(8001)}), /8000 characters/],
        ["another issue", JSON.stringify({question: "q", issue: 8}), /#8, not #7/],
        ["a diff that is not text", JSON.stringify({question: "q", diff: 3}), /diff must be/]
    ];
    for (const [name, text, reason] of rejects) {
        test(`rejects ${name}`, () => {
            assert.throws(() => parseQuestion(text, {issue: 7}), reason);
        });
    }
});

describe("consultKey", () => {
    test("an epic's issues share its key; an issue with none has its own", () => {
        assert.equal(consultKey({issue: 7, epic: 123}), "123");
        assert.equal(consultKey({issue: 8, epic: 123}), "123");
        assert.equal(consultKey({issue: 7, epic: null}), "issue-7");
    });
});

describe("consultPrompt", () => {
    const base = {
        issue: {number: 7, title: "Do it", body: "The issue body"},
        plan: "## Implementation Plan\nthe plan",
        stage: "build",
        question: "Why does it fail?",
        diff: "diff --git a b",
        failing: "1 failing"
    };

    test("carries the issue, plan, stage, question, diff and failing output", () => {
        const text = consultPrompt({...base, epic: null});
        for (const part of [
            "#7 Do it",
            "The issue body",
            "the plan",
            "build",
            "Why does it fail?",
            "diff --git a b",
            "1 failing"
        ]) {
            assert.ok(text.includes(part), part);
        }
        assert.doesNotMatch(text, /## Epic/);
    });

    test("with an epic, carries its body and the siblings with their stages", () => {
        const text = consultPrompt({
            ...base,
            epic: {
                number: 123,
                body: "The epic body",
                siblings: [
                    {number: 7, title: "Do it", stage: "stage:in-progress"},
                    {number: 8, title: "Other", stage: null}
                ]
            }
        });
        assert.match(text, /## Epic #123/);
        assert.ok(text.includes("The epic body"));
        assert.ok(text.includes("- #7 Do it (stage:in-progress)"));
        assert.ok(text.includes("- #8 Other (no stage)"));
    });

    test("with no plan, says so; with a summary, seeds it", () => {
        const text = consultPrompt({...base, plan: null, epic: null, summary: "Before: X"});
        assert.match(text, /no Implementation Plan/);
        assert.match(text, /Before: X/);
    });
});

describe("recordComment", () => {
    test("folds the question and the advice away with the advisor's tokens", () => {
        const body = recordComment({
            stage: "build",
            question: "Why?\nReally?",
            advice: "Because.",
            model: "claude-fable-5-1",
            usage: {tokensIn: 10, cacheRead: 2000, cacheWrite: 0, tokensOut: 500, costUsd: 0.5}
        });
        assert.match(
            body,
            /^<details>\n<summary>🧭 advisor · build · claude-fable-5-1 · 3k tokens<\/summary>/
        );
        assert.match(body, /> Why\?\n> Really\?/);
        assert.match(body, /Because\./);
        assert.match(body, /<\/details>$/);
    });
});

describe("rollsOver", () => {
    test("rolls a session whose context passed the cap; 0 is off", () => {
        assert.equal(rollsOver({session: "s", context: 300000}, 300000), true);
        assert.equal(rollsOver({session: "s", context: 299999}, 300000), false);
        assert.equal(rollsOver({session: "s", context: 900000}, 0), false);
        assert.equal(rollsOver(null, 300000), false);
    });
});

describe("contextOf", () => {
    test("is the input of one turn on average", () => {
        assert.equal(
            contextOf({tokensIn: 100, cacheRead: 1000, cacheWrite: 50, tokensOut: 20, turns: 3}),
            Math.round(1150 / 3)
        );
        assert.equal(contextOf({tokensIn: 9, cacheRead: 0, cacheWrite: 0, turns: 0}), 9);
    });
});

describe("answerText", () => {
    test("is the last result's text", () => {
        const stream = [
            JSON.stringify({type: "assistant", message: {content: [{type: "text", text: "a"}]}}),
            "not json",
            JSON.stringify({type: "result", result: "The advice"})
        ].join("\n");
        assert.equal(answerText(stream), "The advice");
    });

    test("falls back to the last assistant text; null when there is none", () => {
        const stream = [
            JSON.stringify({type: "assistant", message: {content: [{type: "text", text: "a"}]}}),
            JSON.stringify({type: "assistant", message: {content: [{type: "text", text: "b"}]}}),
            JSON.stringify({type: "result", subtype: "success"})
        ].join("\n");
        assert.equal(answerText(stream), "b");
        assert.equal(answerText(""), null);
    });
});

describe("texts", () => {
    test("the refusal names the limit and the setting", () => {
        assert.equal(
            refusal(2),
            "advisor limit reached: 2 consults a session (PIPELINE_ADVISOR_MAX)"
        );
    });

    test("the nudge names the minutes and bin/advise", () => {
        assert.match(nudgeText(22.6), /you have spent 23 minutes on this/);
        assert.match(nudgeText(22.6), /bin\/advise/);
    });
});

describe("addAdvisorUsage", () => {
    test("adds a consult to the session's advisor total", () => {
        const usage = {tokensIn: 1, cacheRead: 2, cacheWrite: 3, tokensOut: 4, costUsd: 0.5};
        const once = addAdvisorUsage(undefined, usage, "m");
        assert.deepEqual(once, {model: "m", consults: 1, ...usage});
        assert.deepEqual(addAdvisorUsage(once, usage, "m"), {
            model: "m",
            consults: 2,
            tokensIn: 2,
            cacheRead: 4,
            cacheWrite: 6,
            tokensOut: 8,
            costUsd: 1
        });
    });
});
