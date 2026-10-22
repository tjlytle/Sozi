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
        assert.doesNotMatch(tests, /edit anything under src\//i);
        assert.match(build, /never create .*feature file/i);
        assert.match(build, /unit test before/i);
        assert.match(build, /red run/i);
    });
    test("the allow list has the project's commands and no docker", () => {
        const allow = fs.readFileSync("pipeline/allow.txt", "utf8");
        for (const line of [
            "Bash(npm *)",
            "Bash(npx *)",
            "Bash(bin/check*)",
            "Bash(gh-as *)",
            "Bash(xvfb-run *)"
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
