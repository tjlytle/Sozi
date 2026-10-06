/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {runSozi, withTempDeck, fixturesDir} = require("./helpers.js");

/** Run `build` on a temp deck and check the output is a single JSON line. */
function build(deck, ...flags) {
    const run = runSozi(["build", ...flags, path.basename(deck.svg)], {cwd: deck.dir});
    assert.equal(run.stdout.trim().split("\n").length, 1, `stdout: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.ok(run.json, `stdout is not JSON: ${run.stdout}\nstderr: ${run.stderr}`);
    return run;
}

/** The `soziPresentationData` object embedded in a presentation HTML file. */
function presentationData(file) {
    const match = /var soziPresentationData = (.*);<\/script>/.exec(fs.readFileSync(file, "utf8"));
    assert.ok(match, `no soziPresentationData in ${file}`);
    return JSON.parse(match[1]);
}

function htmlPaths(deck) {
    const base = deck.svg.replace(/\.svg$/, "");
    return {html: base + ".sozi.html", presenter: base + "-presenter.sozi.html"};
}

describe("build", () => {
    test("writes both HTML files and leaves an existing JSON untouched", () => {
        const deck = withTempDeck("basic");
        try {
            const {code, json, stderr} = build(deck);
            const {html, presenter} = htmlPaths(deck);
            assert.equal(code, 0, `${JSON.stringify(json)}\n${stderr}`);
            assert.equal(json.ok, true);
            assert.equal(json.command, "build");
            assert.equal(json.svg, deck.svg);
            assert.equal(json.presentation, deck.json);
            assert.equal(json.frames, 2);
            assert.deepEqual(json.warnings, []);
            assert.deepEqual(json.errors, []);
            assert.deepEqual(json.files, [html, presenter]);
            for (const file of [html, presenter]) {
                assert.ok(fs.statSync(file).size > 0, file);
            }
            assert.match(fs.readFileSync(html, "utf8"), /soziPresentationData/);
            assert.match(fs.readFileSync(presenter, "utf8"), /basic\.sozi\.html/);
            assert.deepEqual(fs.readFileSync(deck.json), fs.readFileSync(path.join(fixturesDir, "basic.sozi.json")));
        }
        finally {
            deck.cleanup();
        }
    });

    test("rewrites the JSON with --write-json", () => {
        const deck = withTempDeck("basic");
        try {
            // A compact copy of the JSON: the rewrite uses the editor's indentation.
            const compact = JSON.stringify(JSON.parse(fs.readFileSync(deck.json, "utf8")));
            fs.writeFileSync(deck.json, compact);
            const {code, json} = build(deck, "--write-json");
            assert.equal(code, 0, JSON.stringify(json));
            assert.deepEqual(json.files, [...Object.values(htmlPaths(deck)), deck.json]);
            const text = fs.readFileSync(deck.json, "utf8");
            assert.notEqual(text, compact);
            assert.equal(JSON.parse(text).frames.length, 2);
        }
        finally {
            deck.cleanup();
        }
    });

    test("creates the JSON when none exists", () => {
        const deck = withTempDeck("basic");
        try {
            fs.rmSync(deck.json);
            const {code, json} = build(deck);
            assert.equal(code, 0, JSON.stringify(json));
            assert.equal(json.frames, 0);
            assert.deepEqual(json.files, [...Object.values(htmlPaths(deck)), deck.json]);
            assert.equal(JSON.parse(fs.readFileSync(deck.json, "utf8")).frames.length, 0);
        }
        finally {
            deck.cleanup();
        }
    });

    test("warns when the SVG is newer than the existing HTML", () => {
        const deck = withTempDeck("basic");
        try {
            const {html} = htmlPaths(deck);
            fs.writeFileSync(html, "old");
            const past = new Date(Date.now() - 3600 * 1000);
            fs.utimesSync(html, past, past);
            const {code, json} = build(deck);
            assert.equal(code, 0);
            assert.deepEqual(json.warnings, ["svg newer than existing html"]);
            assert.match(fs.readFileSync(html, "utf8"), /soziPresentationData/);
        }
        finally {
            deck.cleanup();
        }
    });

    test("no stale warning when the HTML is newer than the SVG", () => {
        const deck = withTempDeck("basic");
        try {
            const {html} = htmlPaths(deck);
            fs.writeFileSync(html, "new");
            const future = new Date(Date.now() + 3600 * 1000);
            fs.utimesSync(html, future, future);
            const {code, json} = build(deck);
            assert.equal(code, 0);
            assert.deepEqual(json.warnings, []);
        }
        finally {
            deck.cleanup();
        }
    });

    test("fails with exit 1 on an invalid SVG", () => {
        const deck = withTempDeck("basic");
        try {
            fs.writeFileSync(deck.svg, "this is not svg");
            const {code, json} = build(deck);
            assert.equal(code, 1);
            assert.equal(json.ok, false);
            assert.equal(json.command, "build");
            assert.match(json.error, /not valid SVG/);
            assert.ok(!fs.existsSync(htmlPaths(deck).html));
        }
        finally {
            deck.cleanup();
        }
    });

    test("refuses to build when the presentation JSON cannot be parsed", () => {
        const deck = withTempDeck("basic");
        try {
            fs.writeFileSync(deck.json, "{ not json");
            const before = fs.readFileSync(deck.json);
            const {code, json} = build(deck);
            assert.equal(code, 1);
            assert.equal(json.ok, false);
            assert.match(json.error, new RegExp(`^presentation JSON could not be parsed: ${deck.json.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: .+`));
            assert.deepEqual(fs.readFileSync(deck.json), before);
            for (const file of Object.values(htmlPaths(deck))) {
                assert.ok(!fs.existsSync(file), file);
            }
        }
        finally {
            deck.cleanup();
        }
    });

    test("fails with exit 1 when an output file cannot be written", () => {
        const deck = withTempDeck("basic");
        try {
            fs.mkdirSync(htmlPaths(deck).html);
            const {code, json} = build(deck);
            assert.equal(code, 1);
            assert.equal(json.ok, false);
            assert.match(json.error, /EISDIR/);
        }
        finally {
            deck.cleanup();
        }
    });

    test("builds the BattleSnake deck with the frames and layers of its JSON", () => {
        const deck = withTempDeck("battlesnake");
        try {
            const {code, json, stderr} = build(deck);
            assert.equal(code, 0, `${JSON.stringify(json)}\n${stderr}`);
            assert.equal(json.frames, 32);
            const built = presentationData(htmlPaths(deck).html).frames;
            const source = JSON.parse(fs.readFileSync(deck.json, "utf8")).frames;
            assert.equal(built.length, source.length);
            assert.deepEqual(built.map(f => f.frameId), source.map(f => f.frameId));
            built.forEach((frame, i) => {
                assert.deepEqual(Object.keys(frame.layerProperties).sort(), Object.keys(source[i].layerProperties).sort(), frame.frameId);
            });
        }
        finally {
            deck.cleanup();
        }
    });

    test("leaves the BattleSnake JSON byte-identical across two builds", () => {
        const deck = withTempDeck("battlesnake");
        try {
            const original = fs.readFileSync(deck.json);
            for (const run of [1, 2]) {
                const {code, json} = build(deck);
                assert.equal(code, 0, `run ${run}: ${JSON.stringify(json)}`);
                assert.ok(!json.files.includes(deck.json), `run ${run}`);
                assert.ok(fs.readFileSync(deck.json).equals(original), `run ${run}: the JSON changed`);
            }
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("runner", () => {
    test("unknown command exits 2 with usage JSON", () => {
        const deck = withTempDeck("basic");
        try {
            const {code, json} = runSozi(["frobnicate", "basic.svg"], {cwd: deck.dir});
            assert.equal(code, 2);
            assert.equal(json.ok, false);
            assert.match(json.usage, /^sozi --cli/);
            assert.match(json.error, /unknown command: frobnicate/);
            assert.equal(json.command, "frobnicate");
            assert.deepEqual(json.warnings, []);
            assert.deepEqual(json.errors, []);
            assert.ok("svg" in json && "presentation" in json);
        }
        finally {
            deck.cleanup();
        }
    });

    /** Run with bad arguments: exit 2, a usage error, and no file written. */
    function usageError(deck, args, error) {
        const before = fs.readdirSync(deck.dir).sort();
        const {code, stdout, json} = runSozi(args, {cwd: deck.dir});
        assert.equal(code, 2, stdout);
        assert.equal(json.ok, false);
        assert.equal(json.error, error);
        assert.match(json.usage, /^sozi --cli/);
        assert.deepEqual(json.warnings, []);
        assert.deepEqual(json.errors, []);
        assert.deepEqual(fs.readdirSync(deck.dir).sort(), before);
    }

    test("an unknown flag exits 2", () => {
        const deck = withTempDeck("basic");
        try {
            usageError(deck, ["build", "--no-jsn", "basic.svg"], "unknown option for build: --no-jsn");
            usageError(deck, ["build", "--no-json", "basic.svg"], "unknown option for build: --no-json");
            usageError(deck, ["build", "basic.svg", "--verbose"], "unknown option for build: --verbose");
        }
        finally {
            deck.cleanup();
        }
    });

    test("an unknown flag does not consume the file argument", () => {
        const deck = withTempDeck("basic");
        try {
            usageError(deck, ["build", "--dry-run", "basic.svg"], "unknown option for build: --dry-run");
        }
        finally {
            deck.cleanup();
        }
    });

    test("extra positional arguments exit 2", () => {
        const deck = withTempDeck("basic");
        try {
            usageError(deck, ["build", "basic.svg", "basic.sozi.json"], "unexpected argument: basic.sozi.json");
        }
        finally {
            deck.cleanup();
        }
    });
});
