/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The exporter in the Electron main process, without the editor: the harness
// harness/export-main.js calls one export function of the built exporter module
// and prints a JSON report (see mainExport).

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
    runSozi,
    withTempDeck,
    electronBinary,
    ELECTRON_TEST_SWITCHES,
    appDir,
    fixturesDir,
    fakeFfmpeg,
    isAlive,
    limit
} = require("./helpers.js");

/** Run an export function of the built exporter module in the Electron main process.
 *
 * @param {object} args - `{fn, presentation, html, opts}`.
 * @returns {object} - The report of the harness: `{ok, result | error, elapsedMs, windows, isolation}`.
 */
function mainExport(args) {
    const harness = path.join(__dirname, "harness", "export-main.js");
    const exporterModule = path.join(appDir, "src", "js", "exporter", "index.js");
    const electronArgs = [...ELECTRON_TEST_SWITCHES, harness, exporterModule, JSON.stringify(args)];
    const result = spawnSync(electronBinary, electronArgs, {
        encoding: "utf8",
        timeout: limit(60000),
        killSignal: "SIGKILL"
    });
    if (result.error) {
        throw result.error;
    }
    let report;
    try {
        report = JSON.parse(result.stdout);
    } catch {
        assert.fail(`harness output is not JSON: ${result.stdout}\n${result.stderr}`);
    }
    return report;
}

describe("exporter in the main process", () => {
    test("an HTML file without the Sozi player: the export fails within the time limit and closes its window", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-test-"));
        try {
            const html = path.join(dir, "plain.html");
            fs.writeFileSync(
                html,
                "<!doctype html><html><body><p>Not a presentation</p></body></html>"
            );
            const presentation = JSON.parse(
                fs.readFileSync(path.join(fixturesDir, "basic.sozi.json"), "utf8")
            );
            const out = path.join(dir, "plain.pdf");
            const report = mainExport({
                fn: "exportToPDF",
                presentation,
                html,
                opts: {outPath: out, timeoutMs: 2000}
            });
            assert.equal(report.ok, false, JSON.stringify(report));
            assert.match(report.error, /Sozi player did not start within 2 s/);
            assert.ok(report.elapsedMs < 10000, `took ${report.elapsedMs} ms`);
            assert.equal(report.windows, 0);
            assert.ok(!fs.existsSync(out));
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    // A built deck and the default step limit: the export finishes as soon as its work is
    // done, so a busy machine cannot run the limit out before the window reports isolation.
    test("the capture window runs with context isolation", () => {
        const deck = withTempDeck("basic");
        try {
            assert.equal(runSozi(["build", "basic.svg"], {cwd: deck.dir}).code, 0);
            const presentation = JSON.parse(fs.readFileSync(deck.json, "utf8"));
            const report = mainExport({
                fn: "exportToPDF",
                presentation,
                html: path.join(deck.dir, "basic.sozi.html"),
                opts: {outPath: path.join(deck.dir, "basic.pdf")}
            });
            assert.equal(report.ok, true, JSON.stringify(report));
            assert.ok(report.isolation.length > 0, JSON.stringify(report));
            assert.deepEqual(
                report.isolation,
                report.isolation.map(() => true),
                JSON.stringify(report)
            );
        } finally {
            deck.cleanup();
        }
    });

    test("the default ffmpeg time limit is 10 minutes plus 100 ms per image", () => {
        for (const [images, ms] of [
            [0, 600000],
            [12, 601200],
            [30000, 3600000]
        ]) {
            const report = mainExport({fn: "defaultFfmpegTimeoutMs", presentation: images});
            assert.equal(report.ok, true, JSON.stringify(report));
            assert.equal(report.result, ms, `${images} images`);
        }
    });

    test("a failed png sequence export leaves the previous images and creates no directory", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-test-"));
        try {
            const html = path.join(dir, "plain.html");
            fs.writeFileSync(
                html,
                "<!doctype html><html><body><p>Not a presentation</p></body></html>"
            );
            const presentation = Object.assign(
                JSON.parse(fs.readFileSync(path.join(fixturesDir, "basic.sozi.json"), "utf8")),
                {
                    exportToVideoFormat: "png",
                    exportToVideoWidth: 160,
                    exportToVideoHeight: 90,
                    exportToVideoFrameRate: 2
                }
            );
            const seq = path.join(dir, "seq");
            fs.mkdirSync(seq);
            fs.writeFileSync(path.join(seq, "img000000.png"), "previous");
            const failed = mainExport({
                fn: "exportToVideo",
                presentation,
                html,
                opts: {outPath: seq, timeoutMs: 2000}
            });
            assert.equal(failed.ok, false, JSON.stringify(failed));
            assert.deepEqual(fs.readdirSync(seq), ["img000000.png"]);
            assert.equal(fs.readFileSync(path.join(seq, "img000000.png"), "utf8"), "previous");

            const fresh = path.join(dir, "new", "seq");
            assert.equal(
                mainExport({
                    fn: "exportToVideo",
                    presentation,
                    html,
                    opts: {outPath: fresh, timeoutMs: 2000}
                }).ok,
                false
            );
            assert.ok(!fs.existsSync(path.join(dir, "new")));
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    test("an unknown video format fails before anything is captured", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-test-"));
        try {
            const presentation = Object.assign(
                JSON.parse(fs.readFileSync(path.join(fixturesDir, "basic.sozi.json"), "utf8")),
                {exportToVideoFormat: "../evil"}
            );
            const report = mainExport({
                fn: "exportToVideo",
                presentation,
                html: path.join(dir, "deck.sozi.html"),
                opts: {}
            });
            assert.equal(report.ok, false, JSON.stringify(report));
            assert.match(report.error, /unknown video format: \.\.\/evil/);
            assert.deepEqual(fs.readdirSync(dir), []);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    test("a stuck ffmpeg is killed after ffmpegTimeoutMs and the export fails", () => {
        const deck = withTempDeck("basic");
        try {
            assert.equal(runSozi(["build", "basic.svg"], {cwd: deck.dir}).code, 0);
            const ffmpeg = fakeFfmpeg(deck.dir);
            const presentation = Object.assign(JSON.parse(fs.readFileSync(deck.json, "utf8")), {
                exportToVideoFormat: "webm",
                exportToVideoWidth: 160,
                exportToVideoHeight: 90,
                exportToVideoFrameRate: 2
            });
            const out = path.join(deck.dir, "stuck.webm");
            const report = mainExport({
                fn: "exportToVideo",
                presentation,
                html: path.join(deck.dir, "basic.sozi.html"),
                opts: {outPath: out, ffmpegPath: ffmpeg.path, ffmpegTimeoutMs: 1000}
            });
            assert.equal(report.ok, false, JSON.stringify(report));
            assert.match(report.error, /ffmpeg did not finish within 1 s/);
            assert.ok(report.elapsedMs < 20000, `took ${report.elapsedMs} ms`);
            assert.equal(isAlive(ffmpeg.pid()), false, "the ffmpeg process was killed");
            assert.deepEqual(
                fs
                    .readdirSync(deck.dir)
                    .filter(name => name.includes("partial") || name.endsWith(".webm")),
                []
            );
        } finally {
            deck.cleanup();
        }
    });
});
