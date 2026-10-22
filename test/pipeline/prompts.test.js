/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The stage prompts and the allow list: the lines a session and the loop depend on.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const OBVIOUS =
    "It is obvious when the fix is contained to the thing noticed, needs no new dependency and no protocol or API change, and you can say in one sentence why it is better.";
const prompts = ["plan", "tests", "build", "review", "qa"].map(p => [
    p,
    fs.readFileSync(`pipeline/${p}.md`, "utf8")
]);
const spawn = fs.readFileSync("pipeline/spawn.md", "utf8");

describe("stage prompts", () => {
    for (const [name, text] of prompts) {
        test(`${name}: done request, skill, obviousness, persona writes, no record`, () => {
            assert.match(text, /\/outbox\/req-done\.json/);
            assert.match(text, /"done": \{"issue": \{N\}/);
            assert.match(text, /code-standard/);
            assert.doesNotMatch(text, /code-standard\.md/);
            assert.ok(text.includes(OBVIOUS), "obviousness test verbatim");
            assert.match(text, /gh-as (architect|builder|reviewer|qa)/);
            assert.match(text, /Part of #/);
            assert.match(text, /\.agents\/tmp\//);
        });
    }
    test("tests first: QA writes the feature file and sees it fail, the builder never creates it", () => {
        const tests = fs.readFileSync("pipeline/tests.md", "utf8");
        const build = fs.readFileSync("pipeline/build.md", "utf8");
        assert.match(tests, /see (them|it) fail/i);
        assert.match(tests, /"to": "stage:in-progress"/);
        assert.match(tests, /Change nothing under `src\/`/);
        assert.match(build, /never create .*feature file/i);
        assert.match(build, /unit test before/i);
        assert.match(build, /red run/i);
    });
    const text = Object.fromEntries(prompts);
    const persona = {
        plan: "architect",
        tests: "qa",
        build: "builder",
        review: "reviewer",
        qa: "qa"
    };
    const labels = {
        plan: ["triage", "stage:blocked", "stage:tests"],
        tests: ["stage:in-progress"],
        build: ["stage:review"],
        review: ["stage:qa", "stage:in-progress"],
        qa: ["stage:done", "stage:in-progress"]
    };
    for (const [name, who] of Object.entries(persona)) {
        test(`${name}: writes as ${who} and names every label it moves to`, () => {
            assert.ok(text[name].includes(`gh-as ${who} `), `gh-as ${who}`);
            for (const label of labels[name]) {
                assert.ok(text[name].includes(`\`${label}\``), label);
            }
        });
    }
    test("findings: every one is filed, obvious ones to stage:todo, the rest to triage", () => {
        for (const [name, body] of [...prompts, ["spawn", spawn]]) {
            assert.match(body, /file every finding/i, name);
            assert.doesNotMatch(body, /fix the obvious/i, name);
        }
    });
    test("a review policy stops with a wait request, and never alongside a done request", () => {
        for (const name of ["plan", "qa"]) {
            assert.match(text[name], /req-done\.json.*unless a step above told you to stop/s);
            assert.match(text[name], /never write both/);
            assert.match(text[name], /`\/outbox\/req-wait\.json` with\s+`\{"wait": "/);
            assert.doesNotMatch(text[name], /\{"note": "[^"]*waiting/);
        }
        const finish = text.plan.slice(text.plan.indexOf("**Finish.**"));
        const review = finish.indexOf("`Plans: review`");
        assert.ok(review > 0, "Plans: review in the finish step");
        assert.ok(finish.indexOf("is `triage`") < review, "thin goes to triage first");
        assert.ok(finish.indexOf("is `stage:blocked`") < review, "blocked comes first");
    });
    test("qa merges as builder, gated on the reviewer's newest review", () => {
        assert.ok(
            text.qa.includes("gh-as builder pr merge <pr> -R tjlytle/Sozi --squash --delete-branch")
        );
        assert.match(text.qa, /--json reviews/);
        assert.match(text.qa, /reviewer\[bot\]/);
        assert.doesNotMatch(text.qa, /reviewDecision/);
        assert.match(text.qa, /req-missing-evidence\.json/);
        assert.match(text.qa, /req-missing-digest\.json/);
    });
    test("the PR is found by its branch", () => {
        for (const name of ["build", "review", "qa"]) {
            assert.ok(text[name].includes("--head {N}-<slug>"), name);
            assert.doesNotMatch(text[name], /in:body/, name);
        }
    });
    test("the allow list has the project's commands and no docker", () => {
        const allow = fs.readFileSync("pipeline/allow.txt", "utf8");
        for (const line of [
            "Bash(npm *)",
            "Bash(npx *)",
            "Bash(bin/check*)",
            "Bash(gh-as *)",
            "Bash(xvfb-run *)",
            "Bash(tee *)"
        ]) {
            assert.ok(allow.includes(line), line);
        }
        assert.doesNotMatch(allow, /docker/);
    });
});

describe("every prompt", () => {
    const all = [...prompts, ["spawn", spawn]];
    for (const [name, text] of all) {
        test(`${name}: under 120 lines and nothing from the snake`, () => {
            assert.ok(text.split("\n").length < 120, `${name} has too many lines`);
            for (const word of ["make ", "docker", "worktree", ".worktrees", "PHP"]) {
                assert.ok(!text.includes(word), `${name} contains ${word}`);
            }
        });
    }
    test("spawn: persona and request placeholders, a note and no done request", () => {
        assert.ok(spawn.includes("{PERSONA}"));
        assert.ok(spawn.includes("{PROMPT}"));
        assert.match(spawn, /\/outbox\/req-note\.json/);
        assert.doesNotMatch(spawn, /req-done/);
        assert.ok(spawn.includes(OBVIOUS), "obviousness test verbatim");
        assert.match(spawn, /\.agents\/tmp\//);
        assert.doesNotMatch(spawn, /code-standard\.md/);
    });
    test("plan: the seven headings in order", () => {
        const plan = fs.readFileSync("pipeline/plan.md", "utf8");
        const headings = [
            "Behaviour",
            "Scenarios",
            "Shape",
            "Tests",
            "Dependencies",
            "Decisions taken",
            "Blocked by"
        ];
        let at = -1;
        for (const heading of headings) {
            const found = plan.indexOf(`**${heading}**`, at + 1);
            assert.ok(found > at, `${heading} missing or out of order`);
            at = found;
        }
    });
});
