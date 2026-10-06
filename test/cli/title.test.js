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

/** A title with characters that HTML must escape. */
const TRICKY = "<b>&\"";

/** Decode the character references that the HTML serializer emits in text. */
function decodeHtml(text) {
    return text.replace(/&(lt|gt|quot|#39|nbsp|amp);/g, (m, name) =>
        ({lt: "<", gt: ">", quot: "\"", "#39": "'", nbsp: "\u00a0", amp: "&"})[name]);
}

/** The document title of an HTML file after its scripts ran in headless Chrome.
 *
 * Skips the test and returns null when Chrome is missing or cannot be spawned;
 * a Chrome run that fails is a test failure.
 */
function browserTitle(t, file) {
    if (!fs.existsSync(CHROME)) {
        t.skip(`${CHROME} not found`);
        return null;
    }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-chrome-"));
    try {
        const result = spawnSync(CHROME, [
            "--headless=new", "--disable-gpu", "--no-sandbox",
            `--user-data-dir=${profile}`,
            "--dump-dom", "file://" + file
        ], {encoding: "utf8", timeout: 60000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024});
        if (result.error) {
            t.skip(`headless Chrome could not be run: ${result.error}`);
            return null;
        }
        assert.equal(result.status, 0, `headless Chrome failed: ${result.stderr}`);
        const match = /<title>([^<]*)<\/title>/.exec(result.stdout);
        assert.ok(match, "no <title> in the dumped DOM");
        return decodeHtml(match[1]);
    }
    finally {
        fs.rmSync(profile, {recursive: true, force: true});
    }
}

/** Run a command on a temp deck; return the result without checking it. */
function run(deck, command, ...flags) {
    const result = runSozi([command, ...flags, path.basename(deck.svg)], {cwd: deck.dir});
    assert.ok(result.json, `stdout is not JSON: ${result.stdout}\nstderr: ${result.stderr}`);
    return result;
}

function readJson(deck) {
    return JSON.parse(fs.readFileSync(deck.json, "utf8"));
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
        const deck = withTempDeck("basic");
        try {
            setJsonTitle(deck, "My Talk");
            build(deck);
            const title = browserTitle(t, htmlPaths(deck).html);
            if (title !== null) {
                assert.match(title, /My Talk/);
            }
        }
        finally {
            deck.cleanup();
        }
    });

    test("is HTML-escaped in the generated files", (t) => {
        const deck = withTempDeck("basic");
        try {
            build(deck, "--title", TRICKY);
            const {html, presenter} = htmlPaths(deck);
            assert.equal(htmlTitle(html), "&lt;b&gt;&amp;&quot;");
            assert.equal(htmlTitle(presenter), "&lt;b&gt;&amp;&quot;");
            assert.equal(presentationData(html).title, TRICKY);
            const title = browserTitle(t, html);
            if (title !== null) {
                assert.ok(title.startsWith(TRICKY), title);
            }
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("build --title", () => {
    test("cannot break out of the embedded presentation data", (t) => {
        const deck = withTempDeck("basic");
        try {
            const title = "</script><b>x\u2028y";
            build(deck, "--title", title);
            const {html} = htmlPaths(deck);
            const text = fs.readFileSync(html, "utf8");
            const data = /var soziPresentationData = (.*);<\/script>/.exec(text);
            assert.ok(data, "no soziPresentationData");
            assert.equal(data[1].includes("</script><b>x"), false);
            assert.equal(/[\u2028\u2029]/.test(data[1]), false);
            assert.equal(JSON.parse(data[1]).title, title);
            const shown = browserTitle(t, html);
            if (shown !== null) {
                // The player appends the title of the current frame.
                assert.equal(shown, `${title} \u2014 One`);
            }
        }
        finally {
            deck.cleanup();
        }
    });

    test("sets the explicit title in the JSON and both HTML files", () => {
        const deck = withTempDeck("basic");
        try {
            const {json} = build(deck, "--title", "Talk X");
            const {html, presenter} = htmlPaths(deck);
            assert.equal(htmlTitle(html), "Talk X");
            assert.equal(htmlTitle(presenter), "Talk X");
            assert.equal(presentationData(html).title, "Talk X");
            assert.equal(readJson(deck).title, "Talk X");
            assert.ok(json.files.includes(deck.json), JSON.stringify(json.files));
        }
        finally {
            deck.cleanup();
        }
    });

    test("with an empty value clears the explicit title", () => {
        const deck = withTempDeck("basic");
        try {
            setJsonTitle(deck, "My Talk");
            build(deck, "--title", "");
            const {html} = htmlPaths(deck);
            assert.equal(htmlTitle(html), "Basic");
            assert.equal("title" in readJson(deck), false);
            assert.equal("title" in presentationData(html), false);
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("set", () => {
    test("--title writes the JSON only", () => {
        const deck = withTempDeck("basic");
        try {
            const {code, json, stdout, stderr} = run(deck, "set", "--title", "Talk X");
            assert.equal(code, 0, `${stdout}\n${stderr}`);
            assert.equal(stdout.trim().split("\n").length, 1);
            assert.equal(json.ok, true);
            assert.equal(json.command, "set");
            assert.equal(json.error, null);
            assert.deepEqual(json.changed, {title: {from: "", to: "Talk X"}});
            assert.deepEqual(json.files, [deck.json]);
            assert.equal(readJson(deck).title, "Talk X");
            const {html, presenter} = htmlPaths(deck);
            assert.equal(fs.existsSync(html), false);
            assert.equal(fs.existsSync(presenter), false);

            build(deck);
            assert.equal(htmlTitle(html), "Talk X");
        }
        finally {
            deck.cleanup();
        }
    });

    test("--title with an empty value clears the explicit title", () => {
        const deck = withTempDeck("basic");
        try {
            setJsonTitle(deck, "My Talk");
            const {code, json} = run(deck, "set", "--title=");
            assert.equal(code, 0, JSON.stringify(json));
            assert.deepEqual(json.changed, {title: {from: "My Talk", to: ""}});
            assert.equal("title" in readJson(deck), false);
        }
        finally {
            deck.cleanup();
        }
    });

    test("with the current value changes and writes nothing", () => {
        const deck = withTempDeck("basic");
        try {
            setJsonTitle(deck, "My Talk");
            const original = fs.readFileSync(deck.json);
            const {code, json} = run(deck, "set", "--title", "My Talk");
            assert.equal(code, 0, JSON.stringify(json));
            assert.deepEqual(json.changed, {});
            assert.deepEqual(json.files, []);
            assert.deepEqual(fs.readFileSync(deck.json), original);
        }
        finally {
            deck.cleanup();
        }
    });

    test("without an option is a usage error", () => {
        const deck = withTempDeck("basic");
        try {
            const original = fs.readFileSync(deck.json);
            const {code, json} = run(deck, "set");
            assert.equal(code, 2, JSON.stringify(json));
            assert.equal(json.ok, false);
            assert.equal(json.command, "set");
            assert.match(json.error, /no property to set/);
            assert.match(json.usage, /set/);
            assert.deepEqual(fs.readFileSync(deck.json), original);
        }
        finally {
            deck.cleanup();
        }
    });

    test("--title without a value is a usage error", () => {
        const deck = withTempDeck("basic");
        try {
            const {code, json} = runSozi(["set", path.basename(deck.svg), "--title"], {cwd: deck.dir});
            assert.equal(code, 2, JSON.stringify(json));
            assert.equal(json.error, "missing value for --title");
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("inspect title fields", () => {
    for (const [name, fixture, jsonTitle, expected] of [
        ["json", "basic", "My Talk", {title: "My Talk", titleSource: "json", svgTitle: "Basic"}],
        ["svg", "basic", null, {title: "Basic", titleSource: "svg", svgTitle: "Basic"}],
        ["default", "notitle", null, {title: "Untitled", titleSource: "default", svgTitle: ""}]
    ]) {
        test(`reports titleSource ${name}`, () => {
            const deck = withTempDeck(fixture);
            try {
                if (jsonTitle !== null) {
                    setJsonTitle(deck, jsonTitle);
                }
                const {code, json} = run(deck, "inspect");
                assert.equal(code, 0, JSON.stringify(json));
                assert.deepEqual({title: json.title, titleSource: json.titleSource, svgTitle: json.svgTitle}, expected);
            }
            finally {
                deck.cleanup();
            }
        });
    }
});
