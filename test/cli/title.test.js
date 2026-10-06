/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {runSozi, withTempDeck} = require("./helpers.js");

const CHROME = "/usr/bin/google-chrome";

/** Run `build` on a temp deck and check that it succeeded. */
function build(deck, ...flags) {
    const run = runSozi(["build", ...flags, path.basename(deck.svg)], {cwd: deck.dir});
    assert.ok(run.json, `stdout is not JSON: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
    return run;
}

function htmlPaths(deck) {
    const base = deck.svg.replace(/\.svg$/, "");
    return {html: base + ".sozi.html", presenter: base + "-presenter.sozi.html"};
}

/** The text of the `<title>` element in the head of an HTML file. */
function htmlTitle(file) {
    const match = /<head>[\s\S]*?<title>([^<]*)<\/title>/.exec(fs.readFileSync(file, "utf8"));
    assert.ok(match, `no <title> in ${file}`);
    return match[1];
}

/** The `soziPresentationData` object embedded in a presentation HTML file. */
function presentationData(file) {
    const match = /var soziPresentationData = (.*);<\/script>/.exec(fs.readFileSync(file, "utf8"));
    assert.ok(match, `no soziPresentationData in ${file}`);
    return JSON.parse(match[1]);
}

/** Add an explicit title to the JSON of a temp deck, keeping the editor's formatting. */
function setJsonTitle(deck, title) {
    const data = {title, ...JSON.parse(fs.readFileSync(deck.json, "utf8"))};
    fs.writeFileSync(deck.json, JSON.stringify(data, null, "  "));
}

describe("presentation title", () => {
    test("falls back to the SVG title and never writes it to the JSON", () => {
        const deck = withTempDeck("basic");
        try {
            build(deck, "--write-json");
            const {html, presenter} = htmlPaths(deck);
            assert.equal(htmlTitle(html), "Basic");
            assert.equal(htmlTitle(presenter), "Basic");
            assert.equal("title" in JSON.parse(fs.readFileSync(deck.json, "utf8")), false);
            assert.equal("title" in presentationData(html), false);
        }
        finally {
            deck.cleanup();
        }
    });

    test("uses the explicit title from the JSON", () => {
        const deck = withTempDeck("basic");
        try {
            setJsonTitle(deck, "My Talk");
            const original = fs.readFileSync(deck.json);
            build(deck);
            const {html, presenter} = htmlPaths(deck);
            assert.equal(htmlTitle(html), "My Talk");
            assert.match(htmlTitle(presenter), /My Talk/);
            assert.match(fs.readFileSync(html, "utf8"), /"title":"My Talk"/);
            assert.equal(presentationData(html).title, "My Talk");
            assert.deepEqual(fs.readFileSync(deck.json), original);
        }
        finally {
            deck.cleanup();
        }
    });

    test("keeps the explicit title when the JSON is rewritten", () => {
        // The editor normalizes the fixture's JSON when it rewrites it,
        // so compare with a rewrite of the same deck without a title.
        const plain = withTempDeck("basic");
        const titled = withTempDeck("basic");
        try {
            setJsonTitle(titled, "My Talk");
            build(plain, "--write-json");
            build(titled, "--write-json");
            const {title, ...rest} = JSON.parse(fs.readFileSync(titled.json, "utf8"));
            assert.equal(title, "My Talk");
            assert.deepEqual(rest, JSON.parse(fs.readFileSync(plain.json, "utf8")));
        }
        finally {
            plain.cleanup();
            titled.cleanup();
        }
    });

    test("is Untitled when the SVG has no title", () => {
        const deck = withTempDeck("notitle");
        try {
            build(deck, "--write-json");
            const {html, presenter} = htmlPaths(deck);
            assert.equal(htmlTitle(html), "Untitled");
            assert.equal(htmlTitle(presenter), "Untitled");
            assert.equal("title" in JSON.parse(fs.readFileSync(deck.json, "utf8")), false);
            assert.equal("title" in presentationData(html), false);
        }
        finally {
            deck.cleanup();
        }
    });

    test("is Untitled when the SVG title is empty", () => {
        const deck = withTempDeck("basic");
        try {
            const svg = fs.readFileSync(deck.svg, "utf8");
            assert.match(svg, /<title>Basic<\/title>/);
            fs.writeFileSync(deck.svg, svg.replace("<title>Basic</title>", "<title/>"));
            build(deck);
            assert.equal(htmlTitle(htmlPaths(deck).html), "Untitled");
        }
        finally {
            deck.cleanup();
        }
    });

    test("is the document title at runtime in a browser", (t) => {
        if (!fs.existsSync(CHROME)) {
            t.skip(`${CHROME} not found`);
            return;
        }
        const deck = withTempDeck("basic");
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-chrome-"));
        try {
            setJsonTitle(deck, "My Talk");
            build(deck);
            const result = spawnSync(CHROME, [
                "--headless=new", "--disable-gpu", "--no-sandbox",
                `--user-data-dir=${profile}`,
                "--dump-dom", "file://" + htmlPaths(deck).html
            ], {encoding: "utf8", timeout: 60000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024});
            if (result.error || result.status !== 0) {
                t.skip(`headless Chrome failed: ${result.error || result.stderr}`);
                return;
            }
            const match = /<title>([^<]*)<\/title>/.exec(result.stdout);
            assert.ok(match, "no <title> in the dumped DOM");
            assert.match(match[1], /My Talk/);
        }
        finally {
            fs.rmSync(profile, {recursive: true, force: true});
            deck.cleanup();
        }
    });
});
