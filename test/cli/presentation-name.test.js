/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Presentation files named independently of the SVG: the `svg` key of the
// presentation JSON, a `.sozi.json` positional and the `--presentation` flag.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {runSozi, withTempDeck, fixturesDir} = require("./helpers.js");

/** Run a command in the directory of a temp deck and check the output is one JSON document. */
function sozi(deck, ...args) {
    const run = runSozi(args, {cwd: deck.dir});
    assert.equal(run.stdout.trim().split("\n").length, 1, `stdout: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.ok(run.json, `stdout is not JSON: ${run.stdout}\nstderr: ${run.stderr}`);
    return run;
}

/** Like {@link sozi}, and check that the command succeeded. */
function soziOk(deck, ...args) {
    const run = sozi(deck, ...args);
    assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
    assert.equal(run.json.ok, true);
    return run;
}

/** Read a JSON file. */
function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Write a presentation JSON: the basic fixture data with extra keys. */
function writePresentation(file, extra = {}) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const data = {...extra, ...readJson(path.join(fixturesDir, "basic.sozi.json"))};
    fs.writeFileSync(file, JSON.stringify(data, null, "  "));
}

/** The HTML files named after a presentation file. */
function htmlOf(presentation) {
    const base = presentation.replace(/\.sozi\.json$/, "");
    return {html: base + ".sozi.html", presenter: base + "-presenter.sozi.html"};
}

describe("several presentations from one SVG", () => {
    test("--presentation builds HTML pairs named after each presentation, beside it", () => {
        const deck = withTempDeck("basic");
        try {
            // talk-a does not exist: it is created from the SVG.
            // talk-b exists without an svg key: the key is added.
            const a = path.join(deck.dir, "talk-a.sozi.json");
            const b = path.join(deck.dir, "talk-b.sozi.json");
            writePresentation(b);

            const runA = soziOk(deck, "build", "--presentation", "talk-a.sozi.json", "basic.svg");
            assert.equal(runA.json.svg, deck.svg);
            assert.equal(runA.json.presentation, a);
            assert.deepEqual(runA.json.files, [htmlOf(a).html, htmlOf(a).presenter, a]);
            assert.equal(readJson(a).svg, "basic.svg");

            const runB = soziOk(deck, "build", "--presentation=talk-b.sozi.json", "basic.svg");
            assert.equal(runB.json.presentation, b);
            assert.equal(runB.json.frames, 2);
            assert.deepEqual(runB.json.files, [htmlOf(b).html, htmlOf(b).presenter, b]);
            assert.equal(readJson(b).svg, "basic.svg");
            assert.equal(readJson(b).frames.length, 2);

            assert.match(fs.readFileSync(htmlOf(b).presenter, "utf8"), /src="talk-b\.sozi\.html"/);
            assert.equal(fs.existsSync(path.join(deck.dir, "basic.sozi.html")), false);
            assert.equal(fs.existsSync(path.join(deck.dir, "basic-presenter.sozi.html")), false);
            // The default presentation is left alone.
            assert.deepEqual(fs.readFileSync(deck.json), fs.readFileSync(path.join(fixturesDir, "basic.sozi.json")));
        }
        finally {
            deck.cleanup();
        }
    });

    test("a presentation in a subdirectory with svg: ../basic.svg builds there", () => {
        const deck = withTempDeck("basic");
        try {
            const spanish = path.join(deck.dir, "es", "spanish.sozi.json");
            writePresentation(spanish, {svg: "../basic.svg"});
            const before = fs.readFileSync(spanish);

            const {json} = soziOk(deck, "build", "es/spanish.sozi.json");
            assert.equal(json.svg, deck.svg);
            assert.equal(json.presentation, spanish);
            assert.equal(json.frames, 2);
            // Existing JSON with a matching svg key: not rewritten.
            assert.deepEqual(json.files, [htmlOf(spanish).html, htmlOf(spanish).presenter]);
            assert.deepEqual(fs.readFileSync(spanish), before);
            assert.match(fs.readFileSync(htmlOf(spanish).html, "utf8"), /soziPresentationData/);
            assert.match(fs.readFileSync(htmlOf(spanish).presenter, "utf8"), /src="spanish\.sozi\.html"/);
            assert.equal(fs.existsSync(path.join(deck.dir, "basic.sozi.html")), false);
        }
        finally {
            deck.cleanup();
        }
    });

    test("--presentation in another directory creates it with a relative svg key", () => {
        const deck = withTempDeck("basic");
        try {
            const created = path.join(deck.dir, "es", "new.sozi.json");
            fs.mkdirSync(path.dirname(created));
            const {json} = soziOk(deck, "set", "--title", "Hola", "--presentation", "es/new.sozi.json", "basic.svg");
            assert.deepEqual(json.files, [created]);
            const data = readJson(created);
            assert.equal(data.svg, "../basic.svg");
            assert.equal(data.title, "Hola");
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("opening by presentation file", () => {
    test("inspect reports svg, presentation and svgSource", () => {
        const deck = withTempDeck("basic");
        try {
            const spanish = path.join(deck.dir, "es", "spanish.sozi.json");
            writePresentation(spanish, {svg: "../basic.svg", title: "Charla"});

            const byJson = soziOk(deck, "inspect", "es/spanish.sozi.json").json;
            assert.equal(byJson.svg, deck.svg);
            assert.equal(byJson.presentation, spanish);
            assert.equal(byJson.svgSource, "json");
            assert.equal(byJson.title, "Charla");
            assert.equal(byJson.frames.length, 2);

            const byFlag = soziOk(deck, "inspect", "--presentation", "es/spanish.sozi.json", "basic.svg").json;
            assert.equal(byFlag.presentation, spanish);
            assert.equal(byFlag.svgSource, "flag");
            assert.equal(byFlag.title, "Charla");

            const defaultJson = soziOk(deck, "inspect", "basic.sozi.json").json;
            assert.equal(defaultJson.svg, deck.svg);
            assert.equal(defaultJson.presentation, deck.json);
            assert.equal(defaultJson.svgSource, "default");

            const bySvg = soziOk(deck, "inspect", "basic.svg").json;
            assert.equal(bySvg.presentation, deck.json);
            assert.equal(bySvg.svgSource, "default");
        }
        finally {
            deck.cleanup();
        }
    });

    test("build by the default JSON keeps today's names and writes no svg key", () => {
        const deck = withTempDeck("basic");
        try {
            const {json} = soziOk(deck, "build", "basic.sozi.json");
            assert.equal(json.svg, deck.svg);
            assert.deepEqual(json.files, [htmlOf(deck.json).html, htmlOf(deck.json).presenter]);
            assert.deepEqual(fs.readFileSync(deck.json), fs.readFileSync(path.join(fixturesDir, "basic.sozi.json")));
        }
        finally {
            deck.cleanup();
        }
    });

    test("a default deck built from scratch gets no svg key", () => {
        const deck = withTempDeck("basic");
        try {
            fs.rmSync(deck.json);
            const {json} = soziOk(deck, "build", "basic.svg");
            assert.deepEqual(json.files, [htmlOf(deck.json).html, htmlOf(deck.json).presenter, deck.json]);
            assert.equal(Object.hasOwn(readJson(deck.json), "svg"), false);
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("presentation file errors", () => {
    test("a JSON without svg key and no <base>.svg beside it: exit 1", () => {
        const deck = withTempDeck("basic");
        try {
            writePresentation(path.join(deck.dir, "orphan.sozi.json"));
            const {code, json} = sozi(deck, "build", "orphan.sozi.json");
            assert.equal(code, 1);
            assert.equal(json.ok, false);
            assert.match(json.error, /SVG file not found: .*orphan\.svg/);
            assert.match(json.error, /no "svg" key/);
            assert.equal(fs.existsSync(path.join(deck.dir, "orphan.sozi.html")), false);
        }
        finally {
            deck.cleanup();
        }
    });

    test("a JSON whose svg key names a missing file: exit 1", () => {
        const deck = withTempDeck("basic");
        try {
            writePresentation(path.join(deck.dir, "lost.sozi.json"), {svg: "art/missing.svg"});
            const {code, json} = sozi(deck, "inspect", "lost.sozi.json");
            assert.equal(code, 1);
            assert.match(json.error, /SVG file not found: .*art\/missing\.svg/);
        }
        finally {
            deck.cleanup();
        }
    });

    test("--presentation pointing to a directory: exit 2", () => {
        const deck = withTempDeck("basic");
        try {
            fs.mkdirSync(path.join(deck.dir, "es.sozi.json"));
            const {code, json} = sozi(deck, "build", "--presentation", "es.sozi.json", "basic.svg");
            assert.equal(code, 2);
            assert.match(json.error, /--presentation .*is a directory/);
        }
        finally {
            deck.cleanup();
        }
    });

    test("--presentation must name a .json file and needs an SVG argument: exit 2", () => {
        const deck = withTempDeck("basic");
        try {
            const notJson = sozi(deck, "build", "--presentation", "talk.svg", "basic.svg");
            assert.equal(notJson.code, 2);
            assert.match(notJson.json.error, /--presentation .*\.json/);

            const withJson = sozi(deck, "inspect", "--presentation", "talk.sozi.json", "basic.sozi.json");
            assert.equal(withJson.code, 2);
            assert.match(withJson.json.error, /--presentation .*SVG/);
        }
        finally {
            deck.cleanup();
        }
    });
});

/** The names of the files in a directory, recursively, with their contents. */
function snapshot(dir) {
    const result = {};
    for (const name of fs.readdirSync(dir, {recursive: true})) {
        const file = path.join(dir, name);
        if (fs.statSync(file).isFile()) {
            result[name] = fs.readFileSync(file).toString("base64");
        }
    }
    return result;
}

describe("only .sozi.json files are presentations", () => {
    test("a foreign .json beside an SVG of the same base name: exit 1, nothing written", () => {
        const deck = withTempDeck("basic");
        try {
            fs.copyFileSync(deck.svg, path.join(deck.dir, "chart.svg"));
            fs.writeFileSync(path.join(deck.dir, "chart.json"), "{\"data\": [1, 2, 3]}\n");
            const before = snapshot(deck.dir);
            const {code, json} = sozi(deck, "build", "chart.json");
            assert.equal(code, 1);
            assert.equal(json.ok, false);
            assert.match(json.error, /^not a presentation file: .*chart\.json: .+/);
            assert.deepEqual(snapshot(deck.dir), before);
        }
        finally {
            deck.cleanup();
        }
    });

    test("--presentation naming a .json that is not .sozi.json: exit 2", () => {
        const deck = withTempDeck("basic");
        try {
            const before = snapshot(deck.dir);
            const {code, json} = sozi(deck, "build", "--presentation", "x.json", "basic.svg");
            assert.equal(code, 2);
            assert.match(json.error, /--presentation .*\.sozi\.json/);
            assert.deepEqual(snapshot(deck.dir), before);
        }
        finally {
            deck.cleanup();
        }
    });

    test("a .sozi.json without a frames array or not parsable: exit 1, nothing written", () => {
        const deck = withTempDeck("basic");
        try {
            fs.writeFileSync(path.join(deck.dir, "noframes.sozi.json"), JSON.stringify({svg: "basic.svg", title: "x"}));
            fs.writeFileSync(path.join(deck.dir, "broken.sozi.json"), "{ not json");
            const before = snapshot(deck.dir);

            const noFrames = sozi(deck, "build", "noframes.sozi.json");
            assert.equal(noFrames.code, 1);
            assert.match(noFrames.json.error, /^not a presentation file: .*noframes\.sozi\.json: no "frames" array$/);

            const broken = sozi(deck, "build", "broken.sozi.json");
            assert.equal(broken.code, 1);
            assert.match(broken.json.error, /^not a presentation file: .*broken\.sozi\.json: .+/);

            const byFlag = sozi(deck, "build", "--presentation", "noframes.sozi.json", "basic.svg");
            assert.equal(byFlag.code, 1);
            assert.equal(byFlag.json.ok, false);

            assert.deepEqual(snapshot(deck.dir), before);
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("svg key stability", () => {
    test("a key that resolves to the opened SVG is never rewritten", () => {
        const deck = withTempDeck("basic");
        try {
            for (const [name, key] of [["absolute", deck.svg], ["dotted", "./basic.svg"], ["relative", "basic.svg"]]) {
                const file = path.join(deck.dir, `${name}.sozi.json`);
                writePresentation(file, {svg: key});
                const before = fs.readFileSync(file);
                const {json} = soziOk(deck, "build", `${name}.sozi.json`);
                assert.deepEqual(json.files, [htmlOf(file).html, htmlOf(file).presenter], name);
                assert.deepEqual(fs.readFileSync(file), before, name);
            }
        }
        finally {
            deck.cleanup();
        }
    });

    test("retargeting an existing key warns", () => {
        const deck = withTempDeck("basic");
        try {
            fs.copyFileSync(deck.svg, path.join(deck.dir, "other.svg"));
            const talk = path.join(deck.dir, "talk.sozi.json");
            writePresentation(talk, {svg: "basic.svg"});
            const retarget = soziOk(deck, "build", "--presentation", "talk.sozi.json", "other.svg").json;
            assert.ok(retarget.warnings.includes("svg key changed from basic.svg to other.svg"), retarget.warnings.join("\n"));
            assert.equal(readJson(talk).svg, "other.svg");

            // A default presentation bound to another SVG loses its key.
            writePresentation(deck.json, {svg: "other.svg"});
            const unbind = soziOk(deck, "inspect", "basic.svg").json;
            assert.ok(unbind.warnings.includes("svg key changed from other.svg to (none)"), unbind.warnings.join("\n"));

            // Adding a key to a presentation without one is not a change of key.
            writePresentation(path.join(deck.dir, "fresh.sozi.json"));
            const added = soziOk(deck, "build", "--presentation", "fresh.sozi.json", "basic.svg").json;
            assert.ok(!added.warnings.some(w => /svg key changed/.test(w)), added.warnings.join("\n"));
        }
        finally {
            deck.cleanup();
        }
    });
});
