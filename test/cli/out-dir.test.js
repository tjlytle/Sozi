/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The output directory of the HTML files: the `outputDir` key of the
// presentation file, and the rewriting of relative image and media hrefs
// when the HTML is written in another directory than the SVG.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {runSozi, withTempDeck} = require("./helpers.js");

/** Run a command in the directory of a temp deck and check that it succeeded. */
function soziOk(deck, ...args) {
    const run = runSozi(args, {cwd: deck.dir});
    assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
    assert.ok(run.json, `stdout is not JSON: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.equal(run.json.ok, true);
    return run;
}

/** Read a JSON file. */
function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Add keys to a presentation file. */
function addKeys(file, extra) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify({...readJson(file), ...extra}, null, "  "));
}

/** The image hrefs of an HTML file. */
function imageHrefs(file) {
    return [...fs.readFileSync(file, "utf8").matchAll(/<image\b[^>]*?\sxlink:href="([^"]*)"/g)].map(m => m[1]);
}

describe("outputDir key", () => {
    test("the HTML files go to the output directory, with rewritten hrefs", () => {
        const deck = withTempDeck("linked");
        try {
            addKeys(deck.json, {outputDir: "site/talk"});
            const outDir = path.join(deck.dir, "site", "talk");
            const html = path.join(outDir, "linked.sozi.html");
            const presenter = path.join(outDir, "linked-presenter.sozi.html");

            const {json} = soziOk(deck, "build", "linked.svg");

            assert.deepEqual(json.files, [html, presenter]);
            assert.ok(fs.existsSync(html) && fs.existsSync(presenter));
            assert.ok(!fs.existsSync(path.join(deck.dir, "linked.sozi.html")));
            assert.ok(!fs.existsSync(path.join(deck.dir, "linked-presenter.sozi.html")));
            assert.deepEqual(imageHrefs(html), ["../../img/dot.png"]);
            assert.ok(fs.existsSync(path.join(outDir, "../../img/dot.png")));
            assert.match(fs.readFileSync(presenter, "utf8"), /linked\.sozi\.html/);
            // The JSON file stays beside the SVG; the SVG is not copied.
            assert.equal(readJson(deck.json).outputDir, "site/talk");
            assert.deepEqual(fs.readdirSync(outDir).sort(), ["linked-presenter.sozi.html", "linked.sozi.html"]);
            assert.ok(!json.warnings.some(w => /relative image/.test(w)), json.warnings.join("\n"));
        }
        finally {
            deck.cleanup();
        }
    });

    test("the output directory is relative to the directory of the presentation file", () => {
        const deck = withTempDeck("linked");
        try {
            const pres = path.join(deck.dir, "es", "x.sozi.json");
            fs.mkdirSync(path.join(deck.dir, "es"));
            soziOk(deck, "build", "--presentation", "es/x.sozi.json", "linked.svg");
            addKeys(pres, {outputDir: "../site"});
            fs.rmSync(path.join(deck.dir, "es", "x.sozi.html"));

            const {json} = soziOk(deck, "build", "es/x.sozi.json");
            const html = path.join(deck.dir, "site", "x.sozi.html");
            assert.deepEqual(json.files, [html, path.join(deck.dir, "site", "x-presenter.sozi.html")]);
            assert.deepEqual(imageHrefs(html), ["../img/dot.png"]);
            assert.ok(!fs.existsSync(path.join(deck.dir, "es", "x.sozi.html")));
        }
        finally {
            deck.cleanup();
        }
    });

    test("the key survives a rewrite of the presentation file", () => {
        const deck = withTempDeck("linked");
        try {
            addKeys(deck.json, {outputDir: "out"});
            soziOk(deck, "build", "--write-json", "linked.svg");
            assert.equal(readJson(deck.json).outputDir, "out");
            assert.ok(fs.existsSync(path.join(deck.dir, "out", "linked.sozi.html")));
        }
        finally {
            deck.cleanup();
        }
    });

    test("a presentation without the key does not gain it", () => {
        const deck = withTempDeck("basic");
        try {
            soziOk(deck, "build", "--write-json", "basic.svg");
            assert.ok(!("outputDir" in readJson(deck.json)));
        }
        finally {
            deck.cleanup();
        }
    });

    test("a non-string key is ignored with a warning", () => {
        const deck = withTempDeck("linked");
        try {
            addKeys(deck.json, {outputDir: 3});
            const {json} = soziOk(deck, "build", "linked.svg");
            assert.ok(json.warnings.includes(`ignored non-string outputDir in ${deck.json}`), json.warnings.join("\n"));
            assert.deepEqual(imageHrefs(path.join(deck.dir, "linked.sozi.html")), ["img/dot.png"]);
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("relative hrefs and the html directory", () => {
    test("default build: the hrefs are copied unchanged", () => {
        const deck = withTempDeck("linked");
        try {
            const {json} = soziOk(deck, "build", "linked.svg");
            assert.deepEqual(imageHrefs(path.join(deck.dir, "linked.sozi.html")), ["img/dot.png"]);
            assert.deepEqual(json.warnings, []);
        }
        finally {
            deck.cleanup();
        }
    });

    test("a presentation in a subdirectory: the hrefs are rewritten, without a warning", () => {
        const deck = withTempDeck("linked");
        try {
            fs.mkdirSync(path.join(deck.dir, "es"));
            const {json} = soziOk(deck, "build", "--presentation", "es/x.sozi.json", "linked.svg");
            assert.deepEqual(imageHrefs(path.join(deck.dir, "es", "x.sozi.html")), ["../img/dot.png"]);
            assert.ok(!json.warnings.some(w => /relative image/.test(w)), json.warnings.join("\n"));
        }
        finally {
            deck.cleanup();
        }
    });
});
