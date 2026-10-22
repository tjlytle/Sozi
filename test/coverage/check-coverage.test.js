/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests of the coverage-by-annotation check (standard 6.2): the pure parts.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    assess,
    coversOf,
    coveringTests,
    coveredSources,
    entryCovers,
    isSource,
    stem,
    waivers
} from "../../bin/check-coverage.js";

const idx = {
    unitTests: ["test/cli/naming.test.js", "test/unit/protocol/messages.test.ts"],
    features: [
        {
            path: "test/features/presenter/previews.feature",
            covers: ["src/js/presenter.js", "src/templates/presenter.html"]
        },
        {path: "test/features/presenter/notes.feature", covers: ["src/js/presenter/"]}
    ]
};
const sources = [
    "src/js/naming.js",
    "src/js/presenter.js",
    "src/js/presenter/panels/Notes.tsx",
    "src/js/protocol/messages.ts",
    "src/js/player/Player.js",
    "src/templates/presenter.html"
];

describe("coverage by annotation", () => {
    test("what counts as a source file", () => {
        assert.ok(isSource("src/js/presenter/panels/Notes.tsx"));
        assert.ok(isSource("src/templates/presenter.html"));
        assert.ok(!isSource("src/js/types/global.d.ts"));
        assert.ok(!isSource("src/css/theme.css"));
        assert.ok(!isSource("test/cli/naming.test.js"));
    });
    test("the covers header is read, files and directories", () => {
        assert.deepEqual(coversOf("# covers: src/js/a.js, src/js/presenter/\nFeature: x\n"), [
            "src/js/a.js",
            "src/js/presenter/"
        ]);
        assert.deepEqual(coversOf("Feature: x\n"), []);
        assert.ok(entryCovers("src/js/presenter/", "src/js/presenter/panels/Notes.tsx"));
        assert.ok(!entryCovers("src/js/presenter.js", "src/js/presenter/panels/Notes.tsx"));
    });
    test("unit tests cover by base name", () => {
        assert.equal(stem("test/cli/naming.test.js"), "naming");
        assert.equal(stem("src/js/protocol/messages.ts"), "messages");
        assert.deepEqual(coveringTests(idx, "src/js/naming.js"), ["test/cli/naming.test.js"]);
        assert.deepEqual(coveringTests(idx, "src/js/protocol/messages.ts"), [
            "test/unit/protocol/messages.test.ts"
        ]);
    });
    test("feature files cover what their header says", () => {
        assert.deepEqual(coveringTests(idx, "src/js/presenter/panels/Notes.tsx"), [
            "test/features/presenter/notes.feature"
        ]);
        assert.deepEqual(coveringTests(idx, "src/templates/presenter.html"), [
            "test/features/presenter/previews.feature"
        ]);
        assert.deepEqual(coveringTests(idx, "src/js/player/Player.js"), []);
    });
    test("a test knows what it covers", () => {
        assert.deepEqual(coveredSources(idx, sources, "test/features/presenter/notes.feature"), [
            "src/js/presenter/panels/Notes.tsx"
        ]);
        assert.deepEqual(coveredSources(idx, sources, "test/cli/naming.test.js"), [
            "src/js/naming.js"
        ]);
    });
    test("the PR body can waive a file with a reason", () => {
        const w = waivers(
            "Closes #3\n\nNo test: src/js/player/Player.js - cleanup only, behaviour unchanged\n"
        );
        assert.equal(w.get("src/js/player/Player.js"), "cleanup only, behaviour unchanged");
        assert.equal(w.size, 1);
    });
    test("a change set is assessed: covered, uncovered, waived, changed together", () => {
        const report = assess({
            idx,
            sources,
            changed: [
                "src/js/naming.js",
                "test/cli/naming.test.js",
                "src/js/player/Player.js",
                "src/js/protocol/messages.ts",
                "docs/x.md"
            ],
            waived: waivers("No test: src/js/player/Player.js - cleanup")
        });
        assert.deepEqual(
            report.sources.map(s => [s.path, s.covered.length, s.waived]),
            [
                ["src/js/naming.js", 1, null],
                ["src/js/player/Player.js", 0, "cleanup"],
                ["src/js/protocol/messages.ts", 1, null]
            ]
        );
        assert.deepEqual(report.together, [
            {test: "test/cli/naming.test.js", sources: ["src/js/naming.js"]}
        ]);
    });
});
