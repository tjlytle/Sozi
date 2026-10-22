import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {meanAbsDiff, meanAbsDiffDecoded} from "./support/diff.js";
import {createRequire} from "node:module";

const {decodePng, runSozi, withTempDeck} = createRequire(import.meta.url)("../cli/helpers.js");

/**
 * Decoded pixels of an image moved to the right, the left edge repeated.
 *
 * @param {{width: number, height: number, pixel: Function}} png - A decoded image.
 * @param {number} dx - The shift in pixels.
 * @returns {{width: number, height: number, pixel: Function}} - The shifted image.
 */
function shiftRight(png, dx) {
    return {
        width: png.width,
        height: png.height,
        pixel: (x, y) => png.pixel(Math.max(0, x - dx), y)
    };
}

describe("golden diff", () => {
    test("an image equals itself and differs from a shifted copy", () => {
        const a = fs.readFileSync(new URL("./website-1.png", import.meta.url));
        assert.equal(meanAbsDiff(a, a), 0);
        assert.ok(meanAbsDiffDecoded(decodePng(a), shiftRight(decodePng(a), 8)) > 0.02);
    });
});

// Measured on the build that made the goldens: two renders of each frame are
// byte-identical (meanAbsDiff 0), so the tolerance is not there for noise on
// one machine. It leaves room for antialiasing and font differences between
// machines, and is far below the ~0.02 an 8 px shift of a real slide gives.
const tolerance = 0.01;

const goldens = [
    {name: "basic-1", fixture: "basic", frame: 0},
    {name: "basic-2", fixture: "basic", frame: 1},
    {name: "website-1", fixture: "website", frame: 0},
    {name: "website-5", fixture: "website", frame: 4}
];

describe("golden renders", () => {
    for (const {name, fixture, frame} of goldens) {
        test(`${name}: frame ${frame} of ${fixture} renders as the committed image`, () => {
            const deck = withTempDeck(fixture);
            try {
                const svg = path.basename(deck.svg);
                const run = runSozi(
                    [
                        "render",
                        "--frame",
                        String(frame),
                        "--size",
                        "640x360",
                        "--out",
                        "out.png",
                        svg
                    ],
                    {cwd: deck.dir}
                );
                assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
                const rendered = fs.readFileSync(path.join(deck.dir, "out.png"));
                const golden = new URL(`./${name}.png`, import.meta.url);
                if (process.env.UPDATE_GOLDENS) {
                    fs.writeFileSync(golden, rendered);
                    return;
                }
                const diff = meanAbsDiff(rendered, fs.readFileSync(golden));
                assert.ok(
                    diff < tolerance,
                    `${name}: mean difference ${diff} (run UPDATE_GOLDENS=1 npm test to accept a change)`
                );
            } finally {
                deck.cleanup();
            }
        });
    }
});
