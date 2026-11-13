/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The runtime check of `build --out-dir`: the player written to the output
// directory is opened in headless Chrome, which shows the linked image at the
// path the build rewrote.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {runSozi, runReport, withTempDeck} = require("./helpers.js");
const {browserDom, browserScreenshot} = require("./chrome.ts");

/** @typedef {import("./helpers.js").Deck} Deck */
/** @typedef {import("./helpers.js").SoziRun} SoziRun */

/**
 * Run a command in the directory of a temp deck and check that it succeeded.
 *
 * @param {Deck} deck - A temp deck from `withTempDeck`.
 * @param {...string} args - The CLI arguments after `--cli`.
 * @returns {SoziRun} - The result of the run.
 */
function soziOk(deck, ...args) {
    const run = runSozi(args, {cwd: deck.dir});
    assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
    assert.ok(run.json, `stdout is not JSON: ${runReport(run)}`);
    assert.equal(run.json.ok, true);
    return run;
}

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
            const hrefs = [...dom.matchAll(/<image\b[^>]*?\s(?:xlink:)?href="([^"]*)"/g)].map(
                m => m[1]
            );
            assert.deepEqual(hrefs, ["../../img/dot.png"]);
            const image = path.resolve(path.dirname(html), hrefs[0]);
            assert.equal(image, path.join(deck.dir, "img", "dot.png"));
            assert.ok(fs.statSync(image).isFile());
        } finally {
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
            assert.ok(
                greenPixels(shot) > 10000,
                `the image is not shown: ${greenPixels(shot)} green pixels`
            );

            // Control: without the image file, the same page has no green pixel.
            fs.rmSync(path.join(deck.dir, "img", "dot.png"));
            const missing = browserScreenshot(t, html);
            if (missing === null) {
                return;
            }
            assert.equal(greenPixels(missing), 0);
        } finally {
            deck.cleanup();
        }
    });
});
