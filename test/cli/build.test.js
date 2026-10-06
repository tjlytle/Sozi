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

function htmlPaths(deck) {
    const base = deck.svg.replace(/\.svg$/, "");
    return {html: base + ".sozi.html", presenter: base + "-presenter.sozi.html"};
}

describe("build", () => {
    test("writes both HTML files and leaves the JSON untouched with --no-json", () => {
        const deck = withTempDeck("basic");
        try {
            const {code, json, stderr} = build(deck, "--no-json");
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

    test("rewrites the JSON without --no-json", () => {
        const deck = withTempDeck("basic");
        try {
            const {code, json} = build(deck);
            assert.equal(code, 0);
            assert.ok(json.files.includes(deck.json));
            const data = JSON.parse(fs.readFileSync(deck.json, "utf8"));
            assert.equal(data.frames.length, 2);
        }
        finally {
            deck.cleanup();
        }
    });

    test("does not create a JSON file on load when none exists and --no-json is given", () => {
        const deck = withTempDeck("basic");
        try {
            fs.rmSync(deck.json);
            const {code, json} = build(deck, "--no-json");
            assert.equal(code, 0);
            assert.equal(json.frames, 0);
            assert.ok(!fs.existsSync(deck.json));
            assert.deepEqual(json.files, Object.values(htmlPaths(deck)));
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
            const {code, json} = build(deck, "--no-json");
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
            const {code, json} = build(deck, "--no-json");
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
            const {code, json} = build(deck, "--no-json");
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

    test("builds the BattleSnake deck like the GUI does", () => {
        const deck = withTempDeck("battlesnake");
        try {
            const {code, json, stderr} = build(deck, "--no-json");
            assert.equal(code, 0, `${JSON.stringify(json)}\n${stderr}`);
            assert.equal(json.frames, 32);
            const size = fs.statSync(htmlPaths(deck).html).size;
            const reference = fs.statSync(path.join(deck.dir, "hacksnake-edit.reference.sozi.html")).size;
            assert.ok(Math.abs(size - reference) <= reference * 0.1, `size ${size}, reference ${reference}`);
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
});
