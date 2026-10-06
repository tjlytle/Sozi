/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The `render` command: one PNG per frame, captured from the built HTML.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {runSozi, withTempDeck, privateTmp, decodePng, checkPng, checkBasicPng, darkInCorner} = require("./helpers.js");

/** Run a command in the directory of a temp deck and check that it succeeded. */
function soziOk(deck, args, opts = {}) {
    const run = runSozi(args, Object.assign({cwd: deck.dir}, opts));
    assert.ok(run.json, `stdout is not JSON: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
    assert.equal(run.json.ok, true);
    assert.equal(run.json.command, "render");
    return run;
}

/** Run a command in the directory of a temp deck and check its exit code. */
function soziFails(deck, code, args) {
    const run = runSozi(args, {cwd: deck.dir});
    assert.ok(run.json, `stdout is not JSON: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.equal(run.code, code, `${run.stdout}\n${run.stderr}`);
    assert.equal(run.json.ok, false);
    assert.ok(!("exitCode" in run.json));
    return run;
}

/** The number of pixels of an image that are clearly green. */
function greenPixels(png) {
    let count = 0;
    for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
            const [r, g, b] = png.pixel(x, y);
            count += g > r + 80 && g > b + 40 ? 1 : 0;
        }
    }
    return count;
}

/** Set the modification time of a file, in seconds from now. */
function touch(file, secondsFromNow) {
    const t = new Date(Date.now() + secondsFromNow * 1000);
    fs.utimesSync(file, t, t);
}

describe("render --frame", () => {
    test("writes one PNG of the frame at the default size, building the HTML first", () => {
        const deck = withTempDeck("basic");
        try {
            const out = path.join(deck.dir, "f.png");
            const html = path.join(deck.dir, "basic.sozi.html");
            const {json} = soziOk(deck, ["render", "--frame", "0", "--out", "f.png", "basic.svg"]);

            assert.deepEqual(json.files, [out]);
            assert.deepEqual(json.size, {width: 1280, height: 720});
            assert.deepEqual(json.frames, [{index: 0, id: "frame1", file: out}]);
            assert.equal(json.html, html);
            assert.equal(json.rebuilt, true);
            assert.ok(fs.existsSync(html), "the HTML was built");
            assert.match(json.capture, /^(capturePage|cdp)(\+cdp)?$/);
            checkBasicPng(out, 1280, 720);
        }
        finally {
            deck.cleanup();
        }
    });

    test("selects a frame by id, at the requested size", () => {
        const deck = withTempDeck("basic");
        try {
            const out = path.join(deck.dir, "shots", "second.png");
            const {json} = soziOk(deck, ["render", "--frame", "frame2", "--size", "320x180", "--out", "shots/second.png", "basic.svg"]);
            assert.deepEqual(json.frames, [{index: 1, id: "frame2", file: out}]);
            assert.deepEqual(json.size, {width: 320, height: 180});
            checkBasicPng(out, 320, 180);
        }
        finally {
            deck.cleanup();
        }
    });

    test("two renders of the same frame are byte-identical", () => {
        const deck = withTempDeck("basic");
        try {
            soziOk(deck, ["render", "--frame", "1", "--size", "400x300", "--out", "a.png", "basic.svg"]);
            const {json} = soziOk(deck, ["render", "--frame", "1", "--size", "400x300", "--out", "b.png", "basic.svg"]);
            assert.equal(json.rebuilt, false, "the second render reuses the HTML");
            const a = fs.readFileSync(path.join(deck.dir, "a.png"));
            const b = fs.readFileSync(path.join(deck.dir, "b.png"));
            assert.ok(a.equals(b), "the two PNG files differ");
            checkPng(path.join(deck.dir, "a.png"), 400, 300);
        }
        finally {
            deck.cleanup();
        }
    });

    test("different frames give different images", () => {
        // The two frames of the basic fixture look the same but for their frame numbers.
        const deck = withTempDeck("basic");
        try {
            soziOk(deck, ["render", "--frame", "0", "--size", "320x180", "--frame-number", "--out", "a.png", "basic.svg"]);
            soziOk(deck, ["render", "--frame", "1", "--size", "320x180", "--frame-number", "--out", "b.png", "basic.svg"]);
            assert.ok(!fs.readFileSync(path.join(deck.dir, "a.png")).equals(fs.readFileSync(path.join(deck.dir, "b.png"))));
        }
        finally {
            deck.cleanup();
        }
    });

    test("the presentation aspect ratio is fitted inside the image size", () => {
        // A 16:9 frame in a square image: the frame fills a centred band of 360 rows.
        // The fixture frames show the orange rectangle r2 (#cc6633) over the whole frame.
        const deck = withTempDeck("basic");
        try {
            soziOk(deck, ["render", "--frame", "0", "--size", "640x640", "--out", "sq.png", "basic.svg"]);
            const {png} = checkPng(path.join(deck.dir, "sq.png"), 640, 640);
            const orange = ([r, g, b]) => Math.abs(r - 0xcc) < 8 && Math.abs(g - 0x66) < 8 && Math.abs(b - 0x33) < 8;
            const rows = [];
            for (let y = 0; y < 640; y++) {
                if (orange(png.pixel(400, y))) {
                    rows.push(y);
                }
            }
            assert.ok(rows.length >= 358 && rows.length <= 362, `${rows.length} orange rows`);
            assert.ok(Math.abs(rows[0] - 140) <= 2, `the band starts at row ${rows[0]}`);
            assert.ok(!orange(png.pixel(400, 40)) && !orange(png.pixel(400, 600)));
        }
        finally {
            deck.cleanup();
        }
    });

    test("an unknown frame fails with exit code 1 and writes nothing", () => {
        const deck = withTempDeck("basic");
        try {
            const run = soziFails(deck, 1, ["render", "--frame", "nope", "--out", "f.png", "basic.svg"]);
            assert.match(run.json.error, /frame not found: nope/);
            assert.ok(!fs.existsSync(path.join(deck.dir, "f.png")));

            const byIndex = soziFails(deck, 1, ["render", "--frame", "2", "--out", "f.png", "basic.svg"]);
            assert.match(byIndex.json.error, /frame not found: 2/);
            assert.deepEqual(fs.readdirSync(deck.dir).sort(), ["basic.sozi.json", "basic.svg"], "not even the HTML is built");
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("render --all", () => {
    test("writes one zero-padded PNG per frame", () => {
        const deck = withTempDeck("basic");
        try {
            const dir = path.join(deck.dir, "frames");
            // A stale image of an earlier, longer render is removed; other files are kept.
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "frame-007.png"), "stale");
            fs.writeFileSync(path.join(dir, "notes.txt"), "keep");

            const {json} = soziOk(deck, ["render", "--all", "--size", "320x180", "--out", "frames", "basic.svg"]);
            const files = [path.join(dir, "frame-000.png"), path.join(dir, "frame-001.png")];
            assert.deepEqual(json.files, files);
            assert.deepEqual(json.frames, [
                {index: 0, id: "frame1", file: files[0]},
                {index: 1, id: "frame2", file: files[1]}
            ]);
            assert.deepEqual(fs.readdirSync(dir).sort(), ["frame-000.png", "frame-001.png", "notes.txt"]);
            files.forEach(file => checkBasicPng(file, 320, 180));
            // One-colour frames are believed once the Chrome DevTools Protocol agrees: no fallback, no warning.
            assert.equal(json.capture, "capturePage");
            assert.deepEqual(json.warnings, []);
        }
        finally {
            deck.cleanup();
        }
    });

    test("a 32-frame deck: the image count equals the frame count", t => {
        const deck = withTempDeck("battlesnake");
        try {
            const start = Date.now();
            const {json} = soziOk(deck, ["render", "--all", "--size", "320x180", "--out", "frames", "hacksnake-edit.svg"], {timeout: 150000});
            t.diagnostic(`32-frame render --all at 320x180: ${Date.now() - start} ms`);
            assert.equal(json.files.length, 32);
            // No frame is blank: capturePage is used throughout, without falling back to the slower CDP.
            // The command line renders at device scale 1 on any display (see the scale-factor-2 test),
            // so this holds on a high-density desktop as under xvfb.
            assert.equal(json.capture, "capturePage");
            assert.deepEqual(json.warnings, []);
            assert.equal(json.frames.length, 32);
            assert.deepEqual(fs.readdirSync(path.join(deck.dir, "frames")).sort(),
                Array.from({length: 32}, (_, i) => `frame-${String(i).padStart(3, "0")}.png`));
            // Real slides: many colours, not just a frame number on a background.
            for (const file of [json.files[0], json.files[31]]) {
                const {colours} = checkPng(file, 320, 180);
                assert.ok(colours > 20, `${file} has ${colours} colours`);
            }
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("render on a display with scale factor 2", () => {
    test("captures with capturePage at the requested size, without the slower fallback", () => {
        const deck = withTempDeck("basic");
        try {
            const {json} = soziOk(deck, ["render", "--all", "--size", "320x180", "--out", "frames", "basic.svg"],
                {switches: ["--force-device-scale-factor=2"]});
            assert.equal(json.capture, "capturePage");
            assert.deepEqual(json.warnings, []);
            assert.deepEqual(json.size, {width: 320, height: 180});
            json.files.forEach(file => checkBasicPng(file, 320, 180));
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("render and the built HTML", () => {
    test("reuses an up-to-date HTML file, rebuilds a stale one, and --rebuild forces", () => {
        const deck = withTempDeck("basic");
        try {
            const html = path.join(deck.dir, "basic.sozi.html");
            const args = ["render", "--frame", "0", "--size", "160x90", "--out", "f.png", "basic.svg"];
            assert.equal(runSozi(["build", "basic.svg"], {cwd: deck.dir}).code, 0);
            touch(deck.svg, -60);
            touch(deck.json, -60);
            touch(html, -30);
            const built = fs.statSync(html).mtimeMs;

            assert.equal(soziOk(deck, args).json.rebuilt, false);
            assert.equal(fs.statSync(html).mtimeMs, built, "an up-to-date HTML file is not rewritten");

            touch(deck.svg, -10);
            assert.equal(soziOk(deck, args).json.rebuilt, true, "SVG newer than the HTML");
            assert.ok(fs.statSync(html).mtimeMs > built);

            touch(html, -5);
            touch(deck.json, -1);
            assert.equal(soziOk(deck, args).json.rebuilt, true, "JSON newer than the HTML");

            touch(html, 0);
            assert.equal(soziOk(deck, args).json.rebuilt, false);
            assert.equal(soziOk(deck, [...args, "--rebuild"]).json.rebuilt, true);
        }
        finally {
            deck.cleanup();
        }
    });

    test("captures the HTML file in the output directory, from its real path", () => {
        // The fixture image is a 1x1 half-transparent green PNG stretched over the
        // middle of the blue frame, linked by a relative href that only resolves
        // from the HTML file in the output directory after the href rewrite.
        const deck = withTempDeck("linked");
        try {
            const args = ["render", "--frame", "0", "--size", "640x360", "--out", "f.png", "--out-dir", "site/talk", "linked.svg"];
            const {json} = soziOk(deck, args);
            assert.equal(json.html, path.join(deck.dir, "site", "talk", "linked.sozi.html"));
            assert.ok(fs.existsSync(json.html));
            assert.ok(!fs.existsSync(path.join(deck.dir, "linked.sozi.html")));
            const shot = checkPng(path.join(deck.dir, "f.png"), 640, 360).png;
            assert.ok(greenPixels(shot) > 1000, `the image is not shown: ${greenPixels(shot)} green pixels`);

            // Control: without the image file, the same render has no green pixel.
            fs.rmSync(path.join(deck.dir, "img", "dot.png"));
            soziOk(deck, args);
            assert.equal(greenPixels(decodePng(fs.readFileSync(path.join(deck.dir, "f.png")))), 0);
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("render: carried fixes", () => {
    test("after build --write-json the HTML is not older than the JSON: two renders reuse it", () => {
        const deck = withTempDeck("basic");
        try {
            assert.equal(runSozi(["build", "--write-json", "basic.svg"], {cwd: deck.dir}).code, 0);
            const html = fs.statSync(path.join(deck.dir, "basic.sozi.html")).mtimeMs;
            assert.ok(html >= fs.statSync(deck.json).mtimeMs, "the HTML is written after the JSON");
            const args = ["render", "--frame", "0", "--size", "160x90", "--out", "f.png", "basic.svg"];
            assert.equal(soziOk(deck, args).json.rebuilt, false);
            assert.equal(soziOk(deck, args).json.rebuilt, false);
        }
        finally {
            deck.cleanup();
        }
    });

    test("--all keeps the existing images when the render fails", () => {
        const deck = withTempDeck("basic");
        try {
            const dir = path.join(deck.dir, "frames");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "frame-000.png"), "old 0");
            fs.writeFileSync(path.join(dir, "frame-007.png"), "old 7");
            // An up-to-date HTML file without the Sozi player: the capture never starts.
            const html = path.join(deck.dir, "basic.sozi.html");
            fs.writeFileSync(html, "<!doctype html><html><body>not a presentation</body></html>");
            touch(html, 60);
            const tmp = privateTmp(deck.dir);
            const run = runSozi(["render", "--all", "--size", "160x90", "--out", "frames", "--timeout", "4", "basic.svg"],
                {cwd: deck.dir, env: tmp.env});
            assert.equal(run.code, 1, run.stdout);
            assert.deepEqual(tmp.leftovers(), [], "the temporary directory was removed");
            assert.deepEqual(fs.readdirSync(dir).sort(), ["frame-000.png", "frame-007.png"]);
            assert.equal(fs.readFileSync(path.join(dir, "frame-000.png"), "utf8"), "old 0");
        }
        finally {
            deck.cleanup();
        }
    });

    test("the frame-number badge is hidden unless --frame-number", () => {
        const deck = withTempDeck("basic");
        try {
            soziOk(deck, ["render", "--frame", "0", "--size", "320x180", "--out", "plain.png", "basic.svg"]);
            soziOk(deck, ["render", "--frame", "0", "--size", "320x180", "--out", "badge.png", "--frame-number", "basic.svg"]);
            assert.equal(darkInCorner(path.join(deck.dir, "plain.png")), 0, "no badge by default");
            assert.ok(darkInCorner(path.join(deck.dir, "badge.png")) > 50, "the badge is drawn with --frame-number");
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("render usage errors", () => {
    const cases = [
        [["render", "--out", "f.png", "basic.svg"], /--frame <index\|id> or --all/],
        [["render", "--frame", "0", "--all", "--out", "f.png", "basic.svg"], /--frame <index\|id> or --all/],
        [["render", "--frame", "0", "basic.svg"], /--out/],
        [["render", "--frame", "0", "--size", "0x10", "--out", "f.png", "basic.svg"], /--size/],
        [["render", "--all", "--title", "x", "--out", "d", "basic.svg"], /unknown option for render: --title/]
    ];
    for (const [args, message] of cases) {
        test(args.slice(1, -1).join(" "), () => {
            const deck = withTempDeck("basic");
            try {
                const run = soziFails(deck, 2, args);
                assert.match(run.json.error, message);
                assert.deepEqual(fs.readdirSync(deck.dir).sort(), ["basic.sozi.json", "basic.svg"]);
            }
            finally {
                deck.cleanup();
            }
        });
    }

    test("--out is a directory with --frame, or a file with --all", () => {
        const deck = withTempDeck("basic");
        try {
            fs.mkdirSync(path.join(deck.dir, "d"));
            fs.writeFileSync(path.join(deck.dir, "f"), "");
            assert.match(soziFails(deck, 2, ["render", "--frame", "0", "--out", "d", "basic.svg"]).json.error, /is a directory/);
            assert.match(soziFails(deck, 2, ["render", "--all", "--out", "f", "basic.svg"]).json.error, /is not a directory/);
        }
        finally {
            deck.cleanup();
        }
    });
});
