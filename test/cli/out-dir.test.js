/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The output directory of the HTML files: the `outputDir` key of the
// presentation file, and the rewriting of relative image and media hrefs
// when the HTML is written in another directory than the SVG.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
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

/** Run a command in the directory of a temp deck and check that it is a usage error. */
function soziUsageError(deck, ...args) {
    const run = runSozi(args, {cwd: deck.dir});
    assert.ok(run.json, `stdout is not JSON: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.equal(run.code, 2, `${run.stdout}\n${run.stderr}`);
    assert.equal(run.json.ok, false);
    assert.ok(!("exitCode" in run.json));
    return run;
}

const CHROME = "/usr/bin/google-chrome";

/** The DOM of an HTML file after its scripts ran in headless Chrome.
 *
 * Skips the test and returns null when Chrome is missing or cannot be spawned;
 * a Chrome run that fails is a test failure.
 */
function browserDom(t, file) {
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
        return result.stdout;
    }
    finally {
        fs.rmSync(profile, {recursive: true, force: true});
    }
}

/** A PNG screenshot of an HTML file in headless Chrome, after its scripts ran.
 *
 * Skips the test and returns null when Chrome is missing or cannot be spawned.
 */
function browserScreenshot(t, file, {width = 800, height = 450} = {}) {
    if (!fs.existsSync(CHROME)) {
        t.skip(`${CHROME} not found`);
        return null;
    }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-chrome-"));
    try {
        const png = path.join(profile, "shot.png");
        const result = spawnSync(CHROME, [
            "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
            `--user-data-dir=${profile}`,
            // Let the player run its initial transition before the screenshot.
            "--virtual-time-budget=5000",
            `--window-size=${width},${height}`,
            `--screenshot=${png}`, "file://" + file
        ], {encoding: "utf8", timeout: 60000, killSignal: "SIGKILL"});
        if (result.error) {
            t.skip(`headless Chrome could not be run: ${result.error}`);
            return null;
        }
        assert.equal(result.status, 0, `headless Chrome failed: ${result.stderr}`);
        return decodePng(fs.readFileSync(png));
    }
    finally {
        fs.rmSync(profile, {recursive: true, force: true});
    }
}

/** Decode an 8-bit, non-interlaced RGB or RGBA PNG (what Chrome writes).
 *
 * @returns {{width: number, height: number, pixel: Function}} - `pixel(x, y)` gives `[r, g, b]`.
 */
function decodePng(buf) {
    const zlib = require("node:zlib");
    let width, height, channels;
    const idat = [];
    for (let o = 8; o < buf.length; ) {
        const length = buf.readUInt32BE(o);
        const type = buf.toString("ascii", o + 4, o + 8);
        const data = buf.subarray(o + 8, o + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            assert.equal(data[8], 8, "PNG bit depth");
            assert.equal(data[12], 0, "PNG interlace");
            channels = {2: 3, 6: 4}[data[9]];
            assert.ok(channels, `PNG color type ${data[9]}`);
        }
        else if (type === "IDAT") {
            idat.push(data);
        }
        o += 12 + length;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        for (let i = 0; i < stride; i++) {
            const x = raw[y * (stride + 1) + 1 + i];
            const a = i >= channels ? pixels[y * stride + i - channels] : 0;
            const b = y > 0 ? pixels[(y - 1) * stride + i] : 0;
            const c = i >= channels && y > 0 ? pixels[(y - 1) * stride + i - channels] : 0;
            const p = a + b - c;
            const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a :
                Math.abs(p - b) <= Math.abs(p - c) ? b : c;
            pixels[y * stride + i] = (x + [0, a, b, (a + b) >> 1, paeth][filter]) & 0xff;
        }
    }
    return {width, height, pixel: (x, y) => [...pixels.subarray(y * stride + x * channels, y * stride + x * channels + 3)]};
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

    test("the key is trimmed: a blank key means beside the presentation file", () => {
        const deck = withTempDeck("linked");
        try {
            addKeys(deck.json, {outputDir: " "});
            const {json} = soziOk(deck, "build", "linked.svg");
            assert.deepEqual(json.files, [
                path.join(deck.dir, "linked.sozi.html"),
                path.join(deck.dir, "linked-presenter.sozi.html")
            ]);
            assert.ok(!fs.existsSync(path.join(deck.dir, " ")));
            assert.equal(soziOk(deck, "inspect", "linked.svg").json.outputSource, "default");

            addKeys(deck.json, {outputDir: " out "});
            soziOk(deck, "build", "linked.svg");
            assert.ok(fs.existsSync(path.join(deck.dir, "out", "linked.sozi.html")));
            assert.ok(!fs.existsSync(path.join(deck.dir, " out ")));
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

    test("default build: the embedded SVG is the serialized document, byte for byte", () => {
        // An href that a rewrite would normalize, even to the same directory.
        const deck = withTempDeck("linked");
        try {
            const href = "./img/../img/dot.png";
            fs.writeFileSync(deck.svg, fs.readFileSync(deck.svg, "utf8").replace("img/dot.png", href));
            const embeddedSvg = file => fs.readFileSync(file, "utf8").match(/<svg\b[\s\S]*<\/svg>/)[0];

            soziOk(deck, "build", "linked.svg");
            const plain = embeddedSvg(path.join(deck.dir, "linked.sozi.html"));
            assert.deepEqual(imageHrefs(path.join(deck.dir, "linked.sozi.html")), [href]);

            // The same document written elsewhere differs only by its rewritten href,
            // so the default build is the serialized document with no rewrite at all.
            soziOk(deck, "build", "--out-dir", "site/talk", "linked.svg");
            const moved = embeddedSvg(path.join(deck.dir, "site", "talk", "linked.sozi.html"));
            assert.equal(moved, plain.replace(`"${href}"`, "\"../../img/dot.png\""));
            assert.notEqual(moved, plain);
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

describe("--out-dir", () => {
    test("build --out-dir writes both HTML files there, with rewritten hrefs, without storing it", () => {
        const deck = withTempDeck("linked");
        try {
            const before = fs.readFileSync(deck.json, "utf8");
            const outDir = path.join(deck.dir, "site", "talk");
            const html = path.join(outDir, "linked.sozi.html");
            const presenter = path.join(outDir, "linked-presenter.sozi.html");

            const {json} = soziOk(deck, "build", "--out-dir", "site/talk", "linked.svg");

            assert.deepEqual(json.files, [html, presenter]);
            assert.ok(!fs.existsSync(path.join(deck.dir, "linked.sozi.html")));
            assert.ok(!fs.existsSync(path.join(deck.dir, "linked-presenter.sozi.html")));
            assert.deepEqual(imageHrefs(html), ["../../img/dot.png"]);
            assert.ok(fs.existsSync(path.join(outDir, "../../img/dot.png")));
            assert.deepEqual(fs.readdirSync(outDir).sort(), ["linked-presenter.sozi.html", "linked.sozi.html"]);
            assert.equal(fs.readFileSync(deck.json, "utf8"), before);
        }
        finally {
            deck.cleanup();
        }
    });

    test("build --out-dir does not store the key, even when the JSON file is written", () => {
        const deck = withTempDeck("linked");
        try {
            soziOk(deck, "build", "--write-json", "--out-dir", "out", "linked.svg");
            assert.ok(!("outputDir" in readJson(deck.json)));
            assert.ok(fs.existsSync(path.join(deck.dir, "out", "linked.sozi.html")));
        }
        finally {
            deck.cleanup();
        }
    });

    test("build --out-dir overrides the stored key", () => {
        const deck = withTempDeck("linked");
        try {
            addKeys(deck.json, {outputDir: "stored"});
            const {json} = soziOk(deck, "build", "--out-dir=flag", "linked.svg");
            assert.deepEqual(json.files, [
                path.join(deck.dir, "flag", "linked.sozi.html"),
                path.join(deck.dir, "flag", "linked-presenter.sozi.html")
            ]);
            assert.ok(!fs.existsSync(path.join(deck.dir, "stored")));
            assert.equal(readJson(deck.json).outputDir, "stored");
        }
        finally {
            deck.cleanup();
        }
    });

    test("build --out-dir is relative to the working directory", () => {
        const deck = withTempDeck("linked");
        try {
            fs.mkdirSync(path.join(deck.dir, "es"));
            soziOk(deck, "build", "--presentation", "es/x.sozi.json", "--out-dir", "site", "linked.svg");
            const html = path.join(deck.dir, "site", "x.sozi.html");
            assert.ok(fs.existsSync(html));
            assert.deepEqual(imageHrefs(html), ["../img/dot.png"]);
        }
        finally {
            deck.cleanup();
        }
    });

    test("set --out-dir stores the key and build honours it without the flag", () => {
        const deck = withTempDeck("linked");
        try {
            const {json} = soziOk(deck, "set", "--out-dir", "site/talk/", "linked.svg");
            assert.deepEqual(json.changed, {"out-dir": {from: "", to: "site/talk"}});
            assert.deepEqual(json.files, [deck.json]);
            assert.equal(readJson(deck.json).outputDir, "site/talk");
            assert.ok(!fs.existsSync(path.join(deck.dir, "site")), "set writes no HTML and creates no directory");

            const built = soziOk(deck, "build", "linked.svg");
            assert.deepEqual(built.json.files, [
                path.join(deck.dir, "site", "talk", "linked.sozi.html"),
                path.join(deck.dir, "site", "talk", "linked-presenter.sozi.html")
            ]);
        }
        finally {
            deck.cleanup();
        }
    });

    test("set --out-dir stores a path relative to the presentation file, with forward slashes", () => {
        const deck = withTempDeck("linked");
        try {
            fs.mkdirSync(path.join(deck.dir, "es"));
            const pres = path.join(deck.dir, "es", "x.sozi.json");
            soziOk(deck, "set", "--presentation", "es/x.sozi.json", "--out-dir", "site/es", "linked.svg");
            assert.equal(readJson(pres).outputDir, "../site/es");
            soziOk(deck, "set", "--presentation", "es/x.sozi.json", "--out-dir", path.join(deck.dir, "abs"), "linked.svg");
            assert.equal(readJson(pres).outputDir, "../abs");
        }
        finally {
            deck.cleanup();
        }
    });

    test("set --out-dir \"\" removes the key", () => {
        const deck = withTempDeck("linked");
        try {
            addKeys(deck.json, {outputDir: "site"});
            const {json} = soziOk(deck, "set", "--out-dir", "", "linked.svg");
            assert.deepEqual(json.changed, {"out-dir": {from: "site", to: ""}});
            assert.ok(!("outputDir" in readJson(deck.json)));
            soziOk(deck, "build", "linked.svg");
            assert.ok(fs.existsSync(path.join(deck.dir, "linked.sozi.html")));
        }
        finally {
            deck.cleanup();
        }
    });

    test("an output directory that is a file is a usage error and nothing is written", () => {
        const deck = withTempDeck("linked");
        try {
            const before = fs.readFileSync(deck.json, "utf8");
            fs.writeFileSync(path.join(deck.dir, "afile"), "x");

            let {json} = soziUsageError(deck, "build", "--write-json", "--out-dir", "afile", "linked.svg");
            assert.match(json.error, /--out-dir .*afile.* is not a directory/);
            ({json} = soziUsageError(deck, "build", "--out-dir", "afile/sub", "linked.svg"));
            assert.match(json.error, /is not a directory/);
            ({json} = soziUsageError(deck, "set", "--out-dir", "afile", "linked.svg"));
            assert.match(json.error, /--out-dir .*afile.* is not a directory/);
            assert.equal(fs.readFileSync(deck.json, "utf8"), before);

            // inspect reports the error that build exits on, with the same message.
            const built = soziUsageError(deck, "build", "--out-dir", "afile", "linked.svg").json;
            ({json} = soziUsageError(deck, "inspect", "--out-dir", "afile", "linked.svg"));
            assert.equal(json.error, built.error);

            addKeys(deck.json, {outputDir: "afile"});
            ({json} = soziUsageError(deck, "build", "linked.svg"));
            assert.match(json.error, /outputDir .*afile.* is not a directory/);
            assert.equal(soziUsageError(deck, "inspect", "linked.svg").json.error, json.error);
            assert.deepEqual(fs.readdirSync(deck.dir).sort(), ["afile", "img", "linked.sozi.json", "linked.svg"]);
        }
        finally {
            deck.cleanup();
        }
    });

    test("an output directory that cannot be created fails without writing anything", () => {
        const deck = withTempDeck("linked");
        const locked = path.join(deck.dir, "locked");
        try {
            const before = fs.readFileSync(deck.json, "utf8");
            fs.mkdirSync(locked);
            fs.chmodSync(locked, 0o555);
            const run = runSozi(["build", "--out-dir", "locked/site", "linked.svg"], {cwd: deck.dir});
            assert.equal(run.code, 1, `${run.stdout}\n${run.stderr}`);
            assert.equal(run.json.ok, false);
            assert.match(run.json.error, /EACCES/);
            assert.deepEqual(fs.readdirSync(locked), []);
            assert.ok(!fs.existsSync(path.join(deck.dir, "linked.sozi.html")));
            assert.equal(fs.readFileSync(deck.json, "utf8"), before);
        }
        finally {
            fs.chmodSync(locked, 0o755);
            deck.cleanup();
        }
    });

    test("set --out-dir naming the directory of the presentation file removes the key", () => {
        const deck = withTempDeck("linked");
        try {
            addKeys(deck.json, {outputDir: "site"});
            const {json} = soziOk(deck, "set", "--out-dir", ".", "linked.svg");
            assert.deepEqual(json.changed, {"out-dir": {from: "site", to: ""}});
            assert.ok(!("outputDir" in readJson(deck.json)));
        }
        finally {
            deck.cleanup();
        }
    });

    test("build --out-dir needs a non-empty value", () => {
        const deck = withTempDeck("linked");
        try {
            const {json} = soziUsageError(deck, "build", "--out-dir=", "linked.svg");
            assert.equal(json.error, "missing value for --out-dir");
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("inspect and the output directory", () => {
    test("default: outputDir null", () => {
        const deck = withTempDeck("linked");
        try {
            const {json} = soziOk(deck, "inspect", "linked.svg");
            assert.equal(json.outputDir, null);
            assert.equal(json.outputSource, "default");
        }
        finally {
            deck.cleanup();
        }
    });

    test("stored key: the resolved absolute directory", () => {
        const deck = withTempDeck("linked");
        try {
            addKeys(deck.json, {outputDir: "site/talk"});
            const {json} = soziOk(deck, "inspect", "linked.svg");
            assert.equal(json.outputDir, path.join(deck.dir, "site", "talk"));
            assert.equal(json.outputSource, "json");
        }
        finally {
            deck.cleanup();
        }
    });

    test("--out-dir overrides the stored key", () => {
        const deck = withTempDeck("linked");
        try {
            addKeys(deck.json, {outputDir: "site/talk"});
            const {json} = soziOk(deck, "inspect", "--out-dir", "flag", "linked.svg");
            assert.equal(json.outputDir, path.join(deck.dir, "flag"));
            assert.equal(json.outputSource, "flag");
            assert.ok(!fs.existsSync(path.join(deck.dir, "flag")), "inspect creates nothing");
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("runtime check", () => {
    test("the player in the output directory references the linked image at its real path", t => {
        const deck = withTempDeck("linked");
        try {
            soziOk(deck, "build", "--out-dir", "site/talk", "linked.svg");
            const html = path.join(deck.dir, "site", "talk", "linked.sozi.html");
            const dom = browserDom(t, html);
            if (dom === null) {
                return;
            }
            // The player ran: the SVG is in the live DOM, with the rewritten href.
            const hrefs = [...dom.matchAll(/<image\b[^>]*?\s(?:xlink:)?href="([^"]*)"/g)].map(m => m[1]);
            assert.deepEqual(hrefs, ["../../img/dot.png"]);
            const image = path.resolve(path.dirname(html), hrefs[0]);
            assert.equal(image, path.join(deck.dir, "img", "dot.png"));
            assert.ok(fs.statSync(image).isFile());
        }
        finally {
            deck.cleanup();
        }
    });

    test("the player in the output directory shows the linked image", t => {
        // The fixture image is a 1x1 half-transparent green PNG stretched over
        // the middle of the blue frame: only it gives green pixels.
        const greenPixels = shot => {
            let count = 0;
            for (let y = 0; y < shot.height; y++) {
                for (let x = 0; x < shot.width; x++) {
                    const [r, g, b] = shot.pixel(x, y);
                    count += g > r + 80 && g > b + 40 ? 1 : 0;
                }
            }
            return count;
        };
        const deck = withTempDeck("linked");
        try {
            soziOk(deck, "build", "--out-dir", "site/talk", "linked.svg");
            const html = path.join(deck.dir, "site", "talk", "linked.sozi.html");
            const shot = browserScreenshot(t, html);
            if (shot === null) {
                return;
            }
            assert.ok(greenPixels(shot) > 10000, `the image is not shown: ${greenPixels(shot)} green pixels`);

            // Control: without the image file, the same page has no green pixel.
            fs.rmSync(path.join(deck.dir, "img", "dot.png"));
            const missing = browserScreenshot(t, html);
            assert.equal(greenPixels(missing), 0);
        }
        finally {
            deck.cleanup();
        }
    });
});
