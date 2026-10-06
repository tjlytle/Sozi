/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The `export` command: PDF, PPTX, video and PNG sequences from the built HTML.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {PDFDocument} = require("pdf-lib");

const {runSozi, withTempDeck, privateTmp, decodePng, darkInCorner, zipEntries, fakeFfmpeg, failingFfmpeg, isAlive, which} = require("./helpers.js");

/** Run a command in the directory of a temp deck and check that it succeeded. */
function soziOk(deck, args, opts = {}) {
    const run = runSozi(args, Object.assign({cwd: deck.dir}, opts));
    assert.ok(run.json, `stdout is not JSON: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
    assert.equal(run.json.ok, true);
    assert.equal(run.json.command, "export");
    return run;
}

/** Run a command in the directory of a temp deck and check its exit code. */
function soziFails(deck, code, args, opts = {}) {
    const run = runSozi(args, Object.assign({cwd: deck.dir}, opts));
    assert.ok(run.json, `stdout is not JSON: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.equal(run.code, code, `${run.stdout}\n${run.stderr}`);
    assert.equal(run.json.ok, false);
    assert.equal(run.json.command, "export");
    assert.ok(!("exitCode" in run.json));
    return run;
}

/** Change the export settings in the presentation file of a deck. */
function setExportSettings(deck, settings) {
    const data = JSON.parse(fs.readFileSync(deck.json, "utf8"));
    fs.writeFileSync(deck.json, JSON.stringify(Object.assign(data, settings), null, 4));
}

/** The number of pages of a PDF file. */
async function pdfPages(file) {
    return (await PDFDocument.load(fs.readFileSync(file))).getPageCount();
}

/** The number of slides of a PPTX file. */
function pptxSlides(file) {
    return zipEntries(fs.readFileSync(file)).filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).length;
}

/** The number of images of a video of the given frames, computed from their timings.
 *
 * Each frame is held for its timeout (at least one image), then the transition
 * to the next frame plays, one image per step. After the last frame, the video
 * loops back to the first frame only if the last frame's timeout is enabled.
 */
function expectedImages(frames, fps) {
    const stepMs = 1000 / fps;
    let count = 0;
    for (let index = 0; ; ) {
        count += Math.max(1, Math.ceil(frames[index].timeoutMs / stepMs));
        const next = (index + 1) % frames.length;
        if (next === 0 && !frames[index].timeoutEnable) {
            break;
        }
        count += Math.ceil(frames[next].transitionDurationMs / stepMs);
        if (next === 0) {
            break;
        }
        index = next;
    }
    return count;
}

/** The frames of the presentation file of a deck. */
function framesOf(deck) {
    return JSON.parse(fs.readFileSync(deck.json, "utf8")).frames;
}

describe("export pdf", () => {
    test("follows the export settings of the presentation file, building the HTML first", async () => {
        const deck = withTempDeck("basic");
        try {
            const {json} = soziOk(deck, ["export", "basic.svg"]);
            const out = path.join(deck.dir, "basic.sozi.pdf");
            assert.equal(json.type, "pdf");
            assert.equal(json.format, "pdf");
            assert.equal(json.out, out);
            assert.equal(json.frames, 2);
            assert.equal(json.ffmpeg, null);
            assert.equal(json.rebuilt, true);
            assert.equal(json.html, path.join(deck.dir, "basic.sozi.html"));
            assert.equal(await pdfPages(out), 2);
        }
        finally {
            deck.cleanup();
        }
    });

    test("the include and exclude lists of the presentation file select the pages; the flags override them", async () => {
        const deck = withTempDeck("basic");
        try {
            setExportSettings(deck, {exportToPDFInclude: "2"});
            assert.equal(soziOk(deck, ["export", "basic.svg"]).json.frames, 1);
            assert.equal(await pdfPages(path.join(deck.dir, "basic.sozi.pdf")), 1);

            assert.equal(soziOk(deck, ["export", "--include", "1:2", "basic.svg"]).json.frames, 2);
            assert.equal(await pdfPages(path.join(deck.dir, "basic.sozi.pdf")), 2);
        }
        finally {
            deck.cleanup();
        }
    });

    const cases = [
        [["--include", "1:2"], 2],
        [["--include", "2"], 1],
        [["--include", "2:"], 1],
        [["--include", "1,2"], 2],
        [["--include", ":1"], 1],
        [["--include", "1:3:9"], 1],
        [["--include", "1:2:9"], 2],
        [["--exclude", "1"], 1],
        [["--include", "all", "--exclude", "2"], 1]
    ];
    for (const [flags, pages] of cases) {
        test(`frame list ${flags.join(" ")}: ${pages} page(s)`, async () => {
            const deck = withTempDeck("basic");
            try {
                const {json} = soziOk(deck, ["export", ...flags, "--out", "x.pdf", "basic.svg"]);
                assert.equal(json.frames, pages);
                assert.equal(await pdfPages(path.join(deck.dir, "x.pdf")), pages);
            }
            finally {
                deck.cleanup();
            }
        });
    }

    test("an empty selection fails with exit code 1 and writes no PDF", () => {
        const deck = withTempDeck("basic");
        try {
            const run = soziFails(deck, 1, ["export", "--exclude", "all", "--out", "x.pdf", "basic.svg"]);
            assert.match(run.json.error, /no frames selected/);
            assert.ok(!fs.existsSync(path.join(deck.dir, "x.pdf")));
        }
        finally {
            deck.cleanup();
        }
    });

    test("a failed export leaves the previous PDF as it was, and no partial file", () => {
        const deck = withTempDeck("basic");
        try {
            const out = path.join(deck.dir, "x.pdf");
            fs.writeFileSync(out, "previous");
            soziFails(deck, 1, ["export", "--exclude", "all", "--out", "x.pdf", "basic.svg"]);
            assert.equal(fs.readFileSync(out, "utf8"), "previous");
            assert.deepEqual(fs.readdirSync(deck.dir).filter(name => name.includes("partial")), []);
        }
        finally {
            deck.cleanup();
        }
    });

    test("--out is relative to the working directory; missing directories are created", async () => {
        const deck = withTempDeck("basic");
        try {
            const {json} = soziOk(deck, ["export", "--out", "dist/talk.pdf", "basic.svg"]);
            const out = path.join(deck.dir, "dist", "talk.pdf");
            assert.equal(json.out, out);
            assert.equal(await pdfPages(out), 2);
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("export pptx", () => {
    test("one slide per selected frame", () => {
        const deck = withTempDeck("basic");
        try {
            const {json} = soziOk(deck, ["export", "--export-type", "pptx", "basic.svg"]);
            const out = path.join(deck.dir, "basic.sozi.pptx");
            assert.equal(json.type, "pptx");
            assert.equal(json.format, "pptx");
            assert.equal(json.out, out);
            assert.equal(json.frames, 2);
            assert.equal(pptxSlides(out), 2);

            assert.equal(soziOk(deck, ["export", "--export-type", "pptx", "--include", "2", "--out", "one.pptx", "basic.svg"]).json.frames, 1);
            assert.equal(pptxSlides(path.join(deck.dir, "one.pptx")), 1);
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("export video", () => {
    test("png: an image sequence of the stepped timeline, at the requested size", () => {
        const deck = withTempDeck("basic");
        try {
            const fps = 5;
            const images = expectedImages(framesOf(deck), fps);
            assert.equal(images, 7, "basic: 1 image of frame 1, 5 of the 1 s transition, 1 of frame 2");
            const {json} = soziOk(deck, ["export", "--export-type", "video", "--format", "png", "--fps", String(fps),
                "--width", "160", "--height", "90", "--out", "seq", "basic.svg"]);
            const dir = path.join(deck.dir, "seq");
            assert.equal(json.type, "video");
            assert.equal(json.format, "png");
            assert.equal(json.out, dir);
            assert.equal(json.frames, 2);
            assert.equal(json.images, images);
            assert.equal(json.ffmpeg, null);
            const names = fs.readdirSync(dir).sort();
            assert.deepEqual(names, Array.from({length: images}, (_, i) => `img${String(i).padStart(6, "0")}.png`));
            const first = decodePng(fs.readFileSync(path.join(dir, names[0])));
            assert.deepEqual([first.width, first.height], [160, 90]);
            assert.equal(darkInCorner(path.join(dir, names[0])), 0, "no frame-number badge");
        }
        finally {
            deck.cleanup();
        }
    });

    test("png with --frame-number: the images show the frame number", () => {
        const deck = withTempDeck("basic");
        try {
            const {json} = soziOk(deck, ["export", "--export-type", "video", "--format", "png", "--fps", "2",
                "--width", "320", "--height", "180", "--frame-number", "--out", "seq", "basic.svg"]);
            assert.ok(darkInCorner(json.files[0]) > 50, "the frame number is drawn");
        }
        finally {
            deck.cleanup();
        }
    });

    test("png: the images of a hold share one file on disk; earlier images are pruned after success", () => {
        const deck = withTempDeck("basic");
        try {
            // Hold the first frame for 1 s: 5 images at 5 fps.
            const data = JSON.parse(fs.readFileSync(deck.json, "utf8"));
            data.frames[0].timeoutMs = 1000;
            fs.writeFileSync(deck.json, JSON.stringify(data, null, 4));
            const dir = path.join(deck.dir, "seq");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "img000099.png"), "stale");
            fs.writeFileSync(path.join(dir, "notes.txt"), "keep");

            const {json} = soziOk(deck, ["export", "--export-type", "video", "--format", "png", "--fps", "5",
                "--width", "160", "--height", "90", "--out", "seq", "basic.svg"]);
            assert.equal(json.images, expectedImages(framesOf(deck), 5));
            const hold = json.files.slice(0, 5).map(file => fs.statSync(file));
            for (const stat of hold) {
                assert.equal(stat.ino, hold[0].ino, "a hold is written as hard links");
            }
            assert.ok(hold[0].nlink >= 5);
            assert.notEqual(fs.statSync(json.files[5]).ino, hold[0].ino, "a transition image is its own file");
            const names = fs.readdirSync(dir).sort();
            assert.deepEqual(names, [...json.files.map(file => path.basename(file)), "notes.txt"].sort());
        }
        finally {
            deck.cleanup();
        }
    });

    test("png: the video settings of the presentation file", () => {
        const deck = withTempDeck("basic");
        try {
            setExportSettings(deck, {exportType: "video", exportToVideoFormat: "png", exportToVideoFrameRate: 4,
                exportToVideoWidth: 120, exportToVideoHeight: 68});
            const {json} = soziOk(deck, ["export", "basic.svg"]);
            assert.equal(json.type, "video");
            assert.equal(json.format, "png");
            assert.equal(json.out, path.join(deck.dir, "basic-sozi-export"));
            assert.equal(json.images, expectedImages(framesOf(deck), 4));
            const png = decodePng(fs.readFileSync(json.files[0]));
            assert.deepEqual([png.width, png.height], [120, 68]);
        }
        finally {
            deck.cleanup();
        }
    });

    test("webm: encoded by ffmpeg", t => {
        const ffmpeg = which("ffmpeg");
        if (!ffmpeg) {
            t.skip("ffmpeg is not on the PATH");
            return;
        }
        const deck = withTempDeck("basic");
        try {
            const fps = 5;
            const images = expectedImages(framesOf(deck), fps);
            const {json} = soziOk(deck, ["export", "--export-type", "video", "--format", "webm", "--fps", String(fps),
                "--width", "160", "--height", "90", "--bitrate", "200000", "basic.svg"]);
            const video = path.join(deck.dir, "basic.sozi.webm");
            assert.equal(json.out, video);
            assert.equal(json.format, "webm");
            assert.equal(json.ffmpeg, ffmpeg);
            assert.equal(json.frames, 2);
            assert.ok(fs.statSync(video).size > 0);
            if (which("ffprobe")) {
                const probe = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0",
                    "-show_entries", "stream=nb_read_frames,width,height", "-of", "json", video], {encoding: "utf8"});
                assert.equal(probe.status, 0, probe.stderr);
                const stream = JSON.parse(probe.stdout).streams[0];
                assert.deepEqual([stream.width, stream.height], [160, 90]);
                assert.ok(Math.abs(Number(stream.nb_read_frames) - images) <= 1, `${stream.nb_read_frames} frames, expected ${images}`);
            }
            else {
                t.diagnostic("ffprobe is not on the PATH: frame count not checked");
            }
        }
        finally {
            deck.cleanup();
        }
    });

    test("without ffmpeg, a video export fails before building or capturing", () => {
        const deck = withTempDeck("basic");
        try {
            // An empty PATH: no system ffmpeg; the Electron binary of the tests bundles none.
            const empty = path.join(deck.dir, "empty-path");
            fs.mkdirSync(empty);
            const env = Object.assign({}, process.env, {PATH: empty});
            const run = soziFails(deck, 1, ["export", "--export-type", "video", "--format", "mp4", "basic.svg"], {env});
            assert.equal(run.json.error, "ffmpeg not found");
            assert.equal(run.json.ffmpeg, null);
            assert.equal(run.json.type, "video");
            assert.equal(run.json.format, "mp4");
            assert.deepEqual(fs.readdirSync(deck.dir).sort(), ["basic.sozi.json", "basic.svg", "empty-path"]);

            const missing = soziFails(deck, 1, ["export", "--export-type", "video", "--ffmpeg", "no/such/ffmpeg", "basic.svg"]);
            assert.equal(missing.json.error, `ffmpeg not found: ${path.join(deck.dir, "no", "such", "ffmpeg")}`);
        }
        finally {
            deck.cleanup();
        }
    });

    test("a failing ffmpeg leaves the previous video as it was, no partial file and no new directory", () => {
        const deck = withTempDeck("basic");
        try {
            const ffmpeg = failingFfmpeg(deck.dir);
            const out = path.join(deck.dir, "talk.webm");
            fs.writeFileSync(out, "previous");
            const args = ["export", "--export-type", "video", "--format", "webm", "--fps", "2",
                "--width", "160", "--height", "90", "--ffmpeg", ffmpeg];
            const run = soziFails(deck, 1, [...args, "--out", "talk.webm", "basic.svg"]);
            assert.match(run.json.error, /ffmpeg failed \(exit status 1\): simulated failure/);
            assert.equal(fs.readFileSync(out, "utf8"), "previous");
            assert.deepEqual(fs.readdirSync(deck.dir).filter(name => name.includes("partial")), []);

            soziFails(deck, 1, [...args, "--out", "new/sub/talk.webm", "basic.svg"]);
            assert.ok(!fs.existsSync(path.join(deck.dir, "new")), "no empty directory is left");
        }
        finally {
            deck.cleanup();
        }
    });

    test("a stuck ffmpeg does not outlive a command that times out", () => {
        const deck = withTempDeck("basic");
        try {
            const ffmpeg = fakeFfmpeg(deck.dir);
            const tmp = privateTmp(deck.dir);
            const run = soziFails(deck, 1, ["export", "--export-type", "video", "--format", "webm", "--fps", "2",
                "--width", "160", "--height", "90", "--ffmpeg", ffmpeg.path, "--timeout", "8", "basic.svg"], {env: tmp.env});
            assert.match(run.json.error, /timed out after 8 s|ffmpeg did not finish within 8 s/);
            assert.ok(ffmpeg.pid(), "the fake ffmpeg was started");
            assert.equal(isAlive(ffmpeg.pid()), false, "the fake ffmpeg was killed");
            assert.deepEqual(tmp.leftovers(), [], "the captured images were removed");
            assert.deepEqual(fs.readdirSync(deck.dir).filter(name => name.includes("partial")), []);
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("export usage errors", () => {
    const cases = [
        [["--export-type", "gif"], /invalid --export-type: gif/],
        [["--format", "avi"], /invalid --format: avi/],
        [["--export-type", "video", "--fps", "0"], /invalid --fps: 0/],
        [["--export-type", "video", "--width", "10.5"], /invalid --width: 10.5/],
        [["--export-type", "video", "--bitrate", "fast"], /invalid --bitrate: fast/],
        [["--include", "1-2"], /invalid --include: 1-2/],
        [["--export-type", "pdf", "--fps", "10"], /--fps applies to video exports/],
        [["--format", "png"], /--format applies to video exports/],
        [["--export-type", "video", "--include", "1"], /--include applies to pdf and pptx exports/],
        [["--transparent"], /--transparent applies to png image sequences/],
        [["--export-type", "video", "--format", "webm", "--out", "x.mp4"], /extension \.mp4, which does not match the video format webm/],
        [["--export-type", "pptx", "--out", "x.pdf"], /extension \.pdf, which does not match the export type pptx/],
        [["--out", "handout"], /no extension, which does not match the export type pdf/],
        [["--export-type", "video", "--format", "webm", "--transparent"], /--transparent applies to png image sequences/],
        [["--size", "320x180"], /--size does not apply to export; .*--width and --height/],
        [["--export-type", "video", "--size", "320x180"], /--size does not apply to export/]
    ];
    for (const [flags, message] of cases) {
        test(flags.join(" "), () => {
            const deck = withTempDeck("basic");
            try {
                const run = soziFails(deck, 2, ["export", ...flags, "basic.svg"]);
                assert.match(run.json.error, message);
                assert.deepEqual(fs.readdirSync(deck.dir).sort(), ["basic.sozi.json", "basic.svg"]);
            }
            finally {
                deck.cleanup();
            }
        });
    }

    test("--out is a directory for a file export, or a file for a png sequence", () => {
        const deck = withTempDeck("basic");
        try {
            fs.mkdirSync(path.join(deck.dir, "d.pdf"));
            fs.writeFileSync(path.join(deck.dir, "f"), "");
            assert.match(soziFails(deck, 2, ["export", "--out", "d.pdf", "basic.svg"]).json.error, /is a directory/);
            assert.match(soziFails(deck, 2, ["export", "--export-type", "video", "--format", "png", "--out", "f", "basic.svg"]).json.error,
                /is not a directory/);
        }
        finally {
            deck.cleanup();
        }
    });
});
