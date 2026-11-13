/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The `export` command: PDF and PPTX from the built HTML, and its usage errors.
// The video and PNG-sequence exports are tested in export-video.test.js.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {PDFDocument} = require("pdf-lib");

const {runSozi, runReport, withTempDeck} = require("./helpers.js");
const {zipEntries} = require("./decode.ts");

/** @typedef {import("./helpers.js").Deck} Deck */
/** @typedef {import("./helpers.js").SoziRun} SoziRun */

/**
 * Run a command in the directory of a temp deck and check that it succeeded.
 *
 * @param {Deck} deck - A temp deck from `withTempDeck`.
 * @param {string[]} args - The CLI arguments after `--cli`.
 * @param {object} [opts] - More options for `runSozi` (`env`, `timeout`, `switches`).
 * @returns {SoziRun} - The result of the run.
 */
function soziOk(deck, args, opts = {}) {
    const run = runSozi(args, Object.assign({cwd: deck.dir}, opts));
    assert.ok(run.json, `stdout is not JSON: ${runReport(run)}`);
    assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
    assert.equal(run.json.ok, true);
    assert.equal(run.json.command, "export");
    return run;
}

/**
 * Run a command in the directory of a temp deck and check its exit code.
 *
 * @param {Deck} deck - A temp deck from `withTempDeck`.
 * @param {number} code - The expected exit code.
 * @param {string[]} args - The CLI arguments after `--cli`.
 * @param {object} [opts] - More options for `runSozi` (`env`, `timeout`, `switches`).
 * @returns {SoziRun} - The result of the run.
 */
function soziFails(deck, code, args, opts = {}) {
    const run = runSozi(args, Object.assign({cwd: deck.dir}, opts));
    assert.ok(run.json, `stdout is not JSON: ${runReport(run)}`);
    assert.equal(run.code, code, `${run.stdout}\n${run.stderr}`);
    assert.equal(run.json.ok, false);
    assert.equal(run.json.command, "export");
    assert.ok(!("exitCode" in run.json));
    return run;
}

/**
 * Change the export settings in the presentation file of a deck.
 *
 * @param {Deck} deck - A temp deck from `withTempDeck`.
 * @param {object} settings - The properties to set in the presentation file.
 */
function setExportSettings(deck, settings) {
    const data = JSON.parse(fs.readFileSync(deck.json, "utf8"));
    fs.writeFileSync(deck.json, JSON.stringify(Object.assign(data, settings), null, 4));
}

/**
 * The number of pages of a PDF file.
 *
 * @param {string} file - The path of the PDF file.
 * @returns {Promise<number>} - The page count.
 */
async function pdfPages(file) {
    return (await PDFDocument.load(fs.readFileSync(file))).getPageCount();
}

/**
 * The number of slides of a PPTX file.
 *
 * @param {string} file - The path of the PPTX file.
 * @returns {number} - The number of `ppt/slides/slideN.xml` entries in the archive.
 */
function pptxSlides(file) {
    return zipEntries(fs.readFileSync(file)).filter(e =>
        /^ppt\/slides\/slide\d+\.xml$/.test(e.name)
    ).length;
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
        } finally {
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
        } finally {
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
    for (const [flags, pages] of /** @type {[string[], number][]} */ (cases)) {
        test(`frame list ${flags.join(" ")}: ${pages} page(s)`, async () => {
            const deck = withTempDeck("basic");
            try {
                const {json} = soziOk(deck, ["export", ...flags, "--out", "x.pdf", "basic.svg"]);
                assert.equal(json.frames, pages);
                assert.equal(await pdfPages(path.join(deck.dir, "x.pdf")), pages);
            } finally {
                deck.cleanup();
            }
        });
    }

    test("an empty selection fails with exit code 1 and writes no PDF", () => {
        const deck = withTempDeck("basic");
        try {
            const run = soziFails(deck, 1, [
                "export",
                "--exclude",
                "all",
                "--out",
                "x.pdf",
                "basic.svg"
            ]);
            assert.match(run.json.error, /no frames selected/);
            assert.ok(!fs.existsSync(path.join(deck.dir, "x.pdf")));
        } finally {
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
            assert.deepEqual(
                fs.readdirSync(deck.dir).filter(name => name.includes("partial")),
                []
            );
        } finally {
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
        } finally {
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

            assert.equal(
                soziOk(deck, [
                    "export",
                    "--export-type",
                    "pptx",
                    "--include",
                    "2",
                    "--out",
                    "one.pptx",
                    "basic.svg"
                ]).json.frames,
                1
            );
            assert.equal(pptxSlides(path.join(deck.dir, "one.pptx")), 1);
        } finally {
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
        [
            ["--export-type", "video", "--format", "webm", "--out", "x.mp4"],
            /extension \.mp4, which does not match the video format webm/
        ],
        [
            ["--export-type", "pptx", "--out", "x.pdf"],
            /extension \.pdf, which does not match the export type pptx/
        ],
        [["--out", "handout"], /no extension, which does not match the export type pdf/],
        [
            ["--export-type", "video", "--format", "webm", "--transparent"],
            /--transparent applies to png image sequences/
        ],
        [["--size", "320x180"], /--size does not apply to export; .*--width and --height/],
        [["--export-type", "video", "--size", "320x180"], /--size does not apply to export/]
    ];
    for (const [flags, message] of /** @type {[string[], RegExp][]} */ (cases)) {
        test(flags.join(" "), () => {
            const deck = withTempDeck("basic");
            try {
                const run = soziFails(deck, 2, ["export", ...flags, "basic.svg"]);
                assert.match(run.json.error, message);
                assert.deepEqual(fs.readdirSync(deck.dir).sort(), ["basic.sozi.json", "basic.svg"]);
            } finally {
                deck.cleanup();
            }
        });
    }

    test("--out is a directory for a file export, or a file for a png sequence", () => {
        const deck = withTempDeck("basic");
        try {
            fs.mkdirSync(path.join(deck.dir, "d.pdf"));
            fs.writeFileSync(path.join(deck.dir, "f"), "");
            assert.match(
                soziFails(deck, 2, ["export", "--out", "d.pdf", "basic.svg"]).json.error,
                /is a directory/
            );
            assert.match(
                soziFails(deck, 2, [
                    "export",
                    "--export-type",
                    "video",
                    "--format",
                    "png",
                    "--out",
                    "f",
                    "basic.svg"
                ]).json.error,
                /is not a directory/
            );
        } finally {
            deck.cleanup();
        }
    });
});
