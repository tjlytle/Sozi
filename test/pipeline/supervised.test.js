/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The supervision rules: which issues the supervisor runs, which plans need it, and which
// patches it may apply.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    isSupervised,
    planNeedsSupervision,
    protectedPatchPaths
} from "../../pipeline/lib/supervised.js";

/**
 * A plan comment whose Shape section names the given lines.
 *
 * @param {string} shape - The Shape section's body.
 * @param {string} [rest] - Text in the other sections.
 * @returns {string} - The plan.
 */
const plan = (shape, rest = "") =>
    `**Implementation Plan**\n\n### Behaviour\n\n${rest}\n\n### Shape\n\n${shape}\n\n` +
    `### Tests\n\n${rest}\n`;

/**
 * A git diff touching the given paths.
 *
 * @param {string[]} paths - The paths.
 * @returns {string} - The diff.
 */
const diff = paths =>
    paths
        .map(p => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-a\n+b\n`)
        .join("");

describe("isSupervised", () => {
    test("is true for an issue labelled supervised, false otherwise", () => {
        assert.equal(isSupervised({labels: ["stage:todo", "supervised"]}), true);
        assert.equal(isSupervised({labels: ["stage:todo"]}), false);
    });
});

describe("planNeedsSupervision", () => {
    test("a Shape path under .claude/, under pipeline/ or bin/pipeline.js counts", () => {
        assert.equal(planNeedsSupervision(plan("- `.claude/hooks/check-file.py`: x")), true);
        assert.equal(planNeedsSupervision(plan("- `pipeline/lib/due.js`, skip rule")), true);
        assert.equal(planNeedsSupervision(plan("- `bin/pipeline.js`: one line")), true);
    });
    test("Shape paths elsewhere do not count", () => {
        assert.equal(planNeedsSupervision(plan("- `src/js/player.js`, `bin/backlog.js`")), false);
        assert.equal(planNeedsSupervision(plan("- `var/pipeline/protected/<n>.patch`")), false);
    });
    test("a path cited outside the Shape section does not count", () => {
        const text = plan("- `src/js/player.js`", "Like `pipeline/lib/due.js` does.");
        assert.equal(planNeedsSupervision(text), false);
    });
    test("a plan with no Shape section needs none", () => {
        assert.equal(planNeedsSupervision("**Implementation Plan**\n\n`pipeline/x.js`"), false);
        assert.equal(planNeedsSupervision(""), false);
    });
});

describe("protectedPatchPaths", () => {
    test("returns each path the diff names once", () => {
        const text = diff([".claude/hooks/check-file.py", ".claude/settings.json"]);
        assert.deepEqual(protectedPatchPaths(text), [
            ".claude/hooks/check-file.py",
            ".claude/settings.json"
        ]);
    });
    test("a new file's /dev/null side is not a path", () => {
        const text =
            "diff --git a/.claude/x.md b/.claude/x.md\nnew file mode 100644\n" +
            "--- /dev/null\n+++ b/.claude/x.md\n@@ -0,0 +1 @@\n+a\n";
        assert.deepEqual(protectedPatchPaths(text), [".claude/x.md"]);
    });
    test("throws when a path is outside .claude/", () => {
        const text = diff([".claude/hooks/check-file.py", "src/js/player.js"]);
        assert.throws(() => protectedPatchPaths(text), /src\/js\/player\.js/);
    });
    test("throws on a path that climbs out of .claude/ or a rename out of it", () => {
        assert.throws(() => protectedPatchPaths(diff([".claude/../bin/pipeline.js"])), /outside/);
        const rename =
            "diff --git a/.claude/a b/pipeline/a\nsimilarity index 100%\n" +
            "rename from .claude/a\nrename to pipeline/a\n";
        assert.throws(() => protectedPatchPaths(rename), /pipeline\/a/);
    });
    test("throws on a patch that names no path", () => {
        assert.throws(() => protectedPatchPaths("nothing here\n"), /no path/);
    });
    test("throws on a Git-quoted path beside a good one (review of #536)", () => {
        const quoted =
            'diff --git "a/src/a\\tb.js" "b/src/a\\tb.js"\n' +
            '--- "a/src/a\\tb.js"\n+++ "b/src/a\\tb.js"\n@@ -1 +1 @@\n-a\n+b\n';
        const text = diff([".claude/x"]) + quoted;
        assert.throws(() => protectedPatchPaths(text), /cannot read/);
    });
    test("throws on a header with a space in its path or no a/ and b/ prefix", () => {
        const spaced = "diff --git a/src/a b.js b/src/a b.js\nold mode 100644\nnew mode 100755\n";
        assert.throws(() => protectedPatchPaths(diff([".claude/x"]) + spaced), /cannot read/);
        const bare = "--- src/a.js\n+++ src/a.js\n@@ -1 +1 @@\n-a\n+b\n";
        assert.throws(() => protectedPatchPaths(diff([".claude/x"]) + bare), /cannot read/);
    });
});
