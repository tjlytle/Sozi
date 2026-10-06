/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The export of the editor (the Export button path, Controller.exportTo*).
//
// The editor is started in GUI mode on a temp deck with the test hook
// SOZI_TEST_EXPORT=<pdf|pptx|video>: once the deck is open, it runs the
// controller's export method and exits (0 on success). No GUI driver needed.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {PDFDocument} = require("pdf-lib");

const os = require("node:os");

const {runSozi, withTempDeck, decodePng, darkInCorner, electronBinary, appDir, fixturesDir, fakeFfmpeg, isAlive, which, zipEntries} = require("./helpers.js");

/** Run the editor on a deck with the export test hook.
 *
 * @param {object} deck - A temp deck from withTempDeck.
 * @param {string} type - The export type: pdf, pptx or video.
 * @param {string[]} [switches] - Chromium switches for Electron.
 * @returns {{code: number|null, output: string}} - The exit code and the console output.
 */
function guiExport(deck, type, switches = []) {
    const result = spawnSync(electronBinary, [appDir, ...switches, deck.svg], {
        cwd: deck.dir,
        env: Object.assign({}, process.env, {SOZI_TEST_EXPORT: type, ELECTRON_ENABLE_LOGGING: "1"}),
        encoding: "utf8",
        timeout: 90000,
        // Electron ignores SIGTERM while a window is open.
        killSignal: "SIGKILL"
    });
    if (result.error) {
        throw result.error;
    }
    return {code: result.status, output: `${result.stdout}\n${result.stderr}`};
}

/** Change the export settings in the presentation file of a deck.
 *
 * @param {object} deck - A temp deck from withTempDeck.
 * @param {object} settings - The properties to set.
 */
function setExportSettings(deck, settings) {
    const data = JSON.parse(fs.readFileSync(deck.json, "utf8"));
    fs.writeFileSync(deck.json, JSON.stringify(Object.assign(data, settings)));
}

// The basic fixture: 2 frames, timeouts 0 (disabled), transitions 1000 ms.
// At 10 fps a video holds frame 1 (1 image), plays the transition (10 images)
// and holds frame 2 (1 image): 12 images.
const VIDEO_SETTINGS = {exportToVideoWidth: 160, exportToVideoHeight: 90, exportToVideoFrameRate: 10};
const VIDEO_IMAGES = 12;

describe("GUI export (SOZI_TEST_EXPORT)", () => {
    test("pdf: one page per frame", async () => {
        const deck = withTempDeck("basic");
        try {
            const run = guiExport(deck, "pdf");
            assert.equal(run.code, 0, run.output);
            const pdf = await PDFDocument.load(fs.readFileSync(path.join(deck.dir, "basic.sozi.pdf")));
            assert.equal(pdf.getPageCount(), 2);
            // A4 landscape: 297 x 210 mm, in points.
            const {width, height} = pdf.getPage(0).getSize();
            assert.ok(Math.abs(width - 842) < 2 && Math.abs(height - 595) < 2, `page size ${width}x${height}`);
        }
        finally {
            deck.cleanup();
        }
    });

    test("pdf: the include list selects the pages", async () => {
        const deck = withTempDeck("basic");
        try {
            setExportSettings(deck, {exportToPDFInclude: "2"});
            const run = guiExport(deck, "pdf");
            assert.equal(run.code, 0, run.output);
            const pdf = await PDFDocument.load(fs.readFileSync(path.join(deck.dir, "basic.sozi.pdf")));
            assert.equal(pdf.getPageCount(), 1);
        }
        finally {
            deck.cleanup();
        }
    });

    test("pdf: an empty selection fails without writing a file", () => {
        const deck = withTempDeck("basic");
        try {
            setExportSettings(deck, {exportToPDFExclude: "all"});
            const run = guiExport(deck, "pdf");
            assert.equal(run.code, 1, run.output);
            assert.match(run.output, /no frames selected/);
            assert.ok(!fs.existsSync(path.join(deck.dir, "basic.sozi.pdf")));
        }
        finally {
            deck.cleanup();
        }
    });

    test("pptx: one slide per frame", () => {
        const deck = withTempDeck("basic");
        try {
            const run = guiExport(deck, "pptx");
            assert.equal(run.code, 0, run.output);
            const names = zipEntries(fs.readFileSync(path.join(deck.dir, "basic.sozi.pptx"))).map(e => e.name);
            assert.equal(names.filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 2);
        }
        finally {
            deck.cleanup();
        }
    });

    test("video png: a zero-padded image sequence of the stepped timeline", () => {
        const deck = withTempDeck("basic");
        try {
            setExportSettings(deck, Object.assign({exportToVideoFormat: "png"}, VIDEO_SETTINGS));
            const run = guiExport(deck, "video");
            assert.equal(run.code, 0, run.output);
            const dir = path.join(deck.dir, "basic-sozi-export");
            const names = fs.readdirSync(dir).sort();
            assert.deepEqual(names, Array.from({length: VIDEO_IMAGES}, (_, i) => `img${String(i).padStart(6, "0")}.png`));
            const first = decodePng(fs.readFileSync(path.join(dir, names[0])));
            assert.equal(first.width, 160);
            assert.equal(first.height, 90);
            // As upstream, the editor's export shows the frame number (the frames' showFrameNumber setting).
            assert.ok(darkInCorner(path.join(dir, names[0])) > 20, "the frame number is drawn");
        }
        finally {
            deck.cleanup();
        }
    });

    test("pptx on a display with scale factor 2: slide images keep the slide size in pixels", () => {
        const deck = withTempDeck("basic");
        try {
            const run = guiExport(deck, "pptx", ["--force-device-scale-factor=2"]);
            assert.equal(run.code, 0, run.output);
            const media = zipEntries(fs.readFileSync(path.join(deck.dir, "basic.sozi.pptx")))
                .filter(e => /^ppt\/media\/.*\.png$/.test(e.name));
            assert.equal(media.length, 2);
            for (const entry of media) {
                const png = decodePng(entry.data());
                // screen4x3 slides are 1440x1080 pixels.
                assert.deepEqual([png.width, png.height], [1440, 1080], entry.name);
            }
        }
        finally {
            deck.cleanup();
        }
    });

    test("video png on a display with scale factor 2: images have the requested size", () => {
        const deck = withTempDeck("basic");
        try {
            setExportSettings(deck, Object.assign({exportToVideoFormat: "png"}, VIDEO_SETTINGS));
            const run = guiExport(deck, "video", ["--force-device-scale-factor=2"]);
            assert.equal(run.code, 0, run.output);
            // The device-pixel images of capturePage are scaled down, without the slower CDP fallback.
            assert.match(run.output, /Export capture: capturePage\b/);
            assert.doesNotMatch(run.output, /Export capture: \S*cdp/);
            const dir = path.join(deck.dir, "basic-sozi-export");
            const names = fs.readdirSync(dir).sort();
            assert.equal(names.length, VIDEO_IMAGES);
            for (const name of [names[0], names[5]]) {
                const png = decodePng(fs.readFileSync(path.join(dir, name)));
                assert.deepEqual([png.width, png.height], [160, 90], name);
            }
        }
        finally {
            deck.cleanup();
        }
    });

    test("video webm: encoded by ffmpeg", t => {
        if (!which("ffmpeg")) {
            t.skip("ffmpeg is not on the PATH");
            return;
        }
        const deck = withTempDeck("basic");
        try {
            setExportSettings(deck, Object.assign({exportToVideoFormat: "webm"}, VIDEO_SETTINGS));
            const run = guiExport(deck, "video");
            assert.equal(run.code, 0, run.output);
            const video = path.join(deck.dir, "basic.sozi.webm");
            assert.ok(fs.statSync(video).size > 0);
            if (which("ffprobe")) {
                const probe = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0",
                    "-show_entries", "stream=nb_read_frames,width,height", "-of", "json", video], {encoding: "utf8"});
                assert.equal(probe.status, 0, probe.stderr);
                const stream = JSON.parse(probe.stdout).streams[0];
                assert.equal(stream.width, 160);
                assert.equal(stream.height, 90);
                assert.equal(Number(stream.nb_read_frames), VIDEO_IMAGES);
            }
        }
        finally {
            deck.cleanup();
        }
    });
});

/** Run an export function of the built exporter module in the Electron main process.
 *
 * @param {object} args - `{fn, presentation, html, opts}`.
 * @returns {object} - The report of the harness: `{ok, result | error, elapsedMs, windows}`.
 */
function mainExport(args) {
    const harness = path.join(__dirname, "harness", "export-main.js");
    const exporterModule = path.join(appDir, "src", "js", "exporter", "index.js");
    const result = spawnSync(electronBinary, [harness, exporterModule, JSON.stringify(args)], {
        encoding: "utf8",
        timeout: 60000,
        killSignal: "SIGKILL"
    });
    if (result.error) {
        throw result.error;
    }
    try {
        return JSON.parse(result.stdout);
    }
    catch {
        assert.fail(`harness output is not JSON: ${result.stdout}\n${result.stderr}`);
    }
}

describe("exporter in the main process", () => {
    test("an HTML file without the Sozi player: the export fails within the time limit and closes its window", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-test-"));
        try {
            const html = path.join(dir, "plain.html");
            fs.writeFileSync(html, "<!doctype html><html><body><p>Not a presentation</p></body></html>");
            const presentation = JSON.parse(fs.readFileSync(path.join(fixturesDir, "basic.sozi.json"), "utf8"));
            const out = path.join(dir, "plain.pdf");
            const report = mainExport({fn: "exportToPDF", presentation, html, opts: {outPath: out, timeoutMs: 2000}});
            assert.equal(report.ok, false, JSON.stringify(report));
            assert.match(report.error, /Sozi player did not start within 2 s/);
            assert.ok(report.elapsedMs < 10000, `took ${report.elapsedMs} ms`);
            assert.equal(report.windows, 0);
            assert.ok(!fs.existsSync(out));
        }
        finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    test("the default ffmpeg time limit is 10 minutes plus 100 ms per image", () => {
        for (const [images, ms] of [[0, 600000], [12, 601200], [30000, 3600000]]) {
            const report = mainExport({fn: "defaultFfmpegTimeoutMs", presentation: images});
            assert.equal(report.ok, true, JSON.stringify(report));
            assert.equal(report.result, ms, `${images} images`);
        }
    });

    test("a failed png sequence export leaves the previous images and creates no directory", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-test-"));
        try {
            const html = path.join(dir, "plain.html");
            fs.writeFileSync(html, "<!doctype html><html><body><p>Not a presentation</p></body></html>");
            const presentation = Object.assign(JSON.parse(fs.readFileSync(path.join(fixturesDir, "basic.sozi.json"), "utf8")),
                {exportToVideoFormat: "png", exportToVideoWidth: 160, exportToVideoHeight: 90, exportToVideoFrameRate: 2});
            const seq = path.join(dir, "seq");
            fs.mkdirSync(seq);
            fs.writeFileSync(path.join(seq, "img000000.png"), "previous");
            const failed = mainExport({fn: "exportToVideo", presentation, html, opts: {outPath: seq, timeoutMs: 2000}});
            assert.equal(failed.ok, false, JSON.stringify(failed));
            assert.deepEqual(fs.readdirSync(seq), ["img000000.png"]);
            assert.equal(fs.readFileSync(path.join(seq, "img000000.png"), "utf8"), "previous");

            const fresh = path.join(dir, "new", "seq");
            assert.equal(mainExport({fn: "exportToVideo", presentation, html, opts: {outPath: fresh, timeoutMs: 2000}}).ok, false);
            assert.ok(!fs.existsSync(path.join(dir, "new")));
        }
        finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    test("an unknown video format fails before anything is captured", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-test-"));
        try {
            const presentation = Object.assign(JSON.parse(fs.readFileSync(path.join(fixturesDir, "basic.sozi.json"), "utf8")),
                {exportToVideoFormat: "../evil"});
            const report = mainExport({fn: "exportToVideo", presentation, html: path.join(dir, "deck.sozi.html"), opts: {}});
            assert.equal(report.ok, false, JSON.stringify(report));
            assert.match(report.error, /unknown video format: \.\.\/evil/);
            assert.deepEqual(fs.readdirSync(dir), []);
        }
        finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    test("a stuck ffmpeg is killed after ffmpegTimeoutMs and the export fails", () => {
        const deck = withTempDeck("basic");
        try {
            assert.equal(runSozi(["build", "basic.svg"], {cwd: deck.dir}).code, 0);
            const ffmpeg = fakeFfmpeg(deck.dir);
            const presentation = Object.assign(JSON.parse(fs.readFileSync(deck.json, "utf8")),
                {exportToVideoFormat: "webm", exportToVideoWidth: 160, exportToVideoHeight: 90, exportToVideoFrameRate: 2});
            const out = path.join(deck.dir, "stuck.webm");
            const report = mainExport({fn: "exportToVideo", presentation, html: path.join(deck.dir, "basic.sozi.html"),
                opts: {outPath: out, ffmpegPath: ffmpeg.path, ffmpegTimeoutMs: 1000}});
            assert.equal(report.ok, false, JSON.stringify(report));
            assert.match(report.error, /ffmpeg did not finish within 1 s/);
            assert.ok(report.elapsedMs < 20000, `took ${report.elapsedMs} ms`);
            assert.equal(isAlive(ffmpeg.pid()), false, "the ffmpeg process was killed");
            assert.deepEqual(fs.readdirSync(deck.dir).filter(name => name.includes("partial") || name.endsWith(".webm")), []);
        }
        finally {
            deck.cleanup();
        }
    });
});
