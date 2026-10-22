/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests of the code standard skill: the version of the standard agents read.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = ".claude/skills/code-standard";
const skill = fs.readFileSync(`${dir}/SKILL.md`, "utf8");
const refs = Object.fromEntries(
    fs
        .readdirSync(`${dir}/references`)
        .map(f => [f, fs.readFileSync(`${dir}/references/${f}`, "utf8")])
);
const all = skill + Object.values(refs).join("\n");
const record = fs.readFileSync("docs/software-factory/code-standard.md", "utf8");

describe("the code standard skill", () => {
    test("has Agent Skills frontmatter", () => {
        assert.match(
            skill,
            /^---\nname: code-standard\ndescription: The Sozi fork's code standard/
        );
    });
    test("covers every numbered section of the record, in SKILL.md or a reference", () => {
        const numbers = [...record.matchAll(/^### (\d\.\d) /gm)].map(m => m[1]);
        assert.ok(numbers.length >= 20);
        for (const n of numbers) {
            assert.match(all, new RegExp(`^### ${n.replace(".", "\\.")} `, "m"), `section ${n}`);
        }
    });
    test("SKILL.md names every reference file", () => {
        assert.deepEqual(Object.keys(refs).sort(), [
            "change.md",
            "css.md",
            "dependencies.md",
            "javascript.md",
            "tests.md"
        ]);
        for (const f of Object.keys(refs)) {
            assert.ok(skill.includes(`references/${f}`), f);
        }
    });
    test("is short and declarative", () => {
        assert.ok(skill.split("\n").length <= 100, "SKILL.md under 100 lines");
        for (const [f, text] of Object.entries(refs)) {
            assert.ok(text.split("\n").length <= 120, `${f} under 120 lines`);
        }
        assert.doesNotMatch(all, /alternative|we could have|instead of|decided/i);
        assert.doesNotMatch(all, /code-standard\.md/);
    });
    test("no hook, script or lint message cites the record", () => {
        const files = [
            "config/eslintrc.mjs",
            "config/stylelintrc.json",
            ".claude/hooks/check-file.py",
            "bin/check-pr.js",
            "bin/check-deps.js",
            "bin/check-coverage.js",
            ".github/workflows/ci.yml",
            ".github/PULL_REQUEST_TEMPLATE.md"
        ];
        for (const f of files) {
            assert.doesNotMatch(fs.readFileSync(f, "utf8"), /code-standard\.md/, f);
        }
    });
});
