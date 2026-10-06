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

const {withTempDeck, decodePng, electronBinary, appDir} = require("./helpers.js");

/** Run the editor on a deck with the export test hook.
 *
 * @param {object} deck - A temp deck from withTempDeck.
 * @param {string} type - The export type: pdf, pptx or video.
 * @returns {{code: number|null, output: string}} - The exit code and the console output.
 */
function guiExport(deck, type) {
    const result = spawnSync(electronBinary, [appDir, deck.svg], {
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

/** The names of the entries of a zip file, from its central directory.
 *
 * @param {Buffer} buf - The content of a zip file.
 * @returns {string[]} - The entry names.
 */
function zipEntries(buf) {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(eocd >= 0, "zip end of central directory");
    const count = buf.readUInt16LE(eocd + 10);
    let o = buf.readUInt32LE(eocd + 16);
    const names = [];
    for (let i = 0; i < count; i++) {
        assert.equal(buf.readUInt32LE(o), 0x02014b50, "zip central directory entry");
        const nameLength    = buf.readUInt16LE(o + 28);
        const extraLength   = buf.readUInt16LE(o + 30);
        const commentLength = buf.readUInt16LE(o + 32);
        names.push(buf.toString("utf8", o + 46, o + 46 + nameLength));
        o += 46 + nameLength + extraLength + commentLength;
    }
    return names;
}

/** Find an executable on the PATH.
 *
 * @param {string} name - The executable name.
 * @returns {?string} - Its path, or null.
 */
function which(name) {
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
        const file = path.join(dir, name);
        try {
            fs.accessSync(file, fs.constants.X_OK);
            return file;
        }
        catch {
            // Not in this directory.
        }
    }
    return null;
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
            const entries = zipEntries(fs.readFileSync(path.join(deck.dir, "basic.sozi.pptx")));
            assert.equal(entries.filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 2);
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
