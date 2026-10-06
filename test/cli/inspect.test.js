/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {runSozi, withTempDeck} = require("./helpers.js");

/** Run `inspect` on a temp deck and check the output is a single JSON line. */
function inspect(deck, ...flags) {
    const run = runSozi(["inspect", ...flags, path.basename(deck.svg)], {cwd: deck.dir});
    assert.equal(run.stdout.trim().split("\n").length, 1, `stdout: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.ok(run.json, `stdout is not JSON: ${run.stdout}\nstderr: ${run.stderr}`);
    return run;
}

/** The names, sizes and mtimes of the files in a directory. */
function snapshot(dir) {
    return fs.readdirSync(dir).sort().map(name => {
        const stat = fs.statSync(path.join(dir, name));
        return {name, size: stat.size, mtimeMs: stat.mtimeMs};
    });
}

describe("inspect", () => {
    test("reports the presentation, its layers and its frames", () => {
        const deck = withTempDeck("basic");
        try {
            const {code, json, stderr} = inspect(deck);
            assert.equal(code, 0, `${JSON.stringify(json)}\n${stderr}`);
            assert.equal(json.ok, true);
            assert.equal(json.command, "inspect");
            assert.equal(json.svg, deck.svg);
            assert.equal(json.presentation, deck.json);
            assert.equal(json.title, "Basic");
            assert.deepEqual(json.aspect, {width: 16, height: 9});
            assert.deepEqual(json.warnings, []);
            assert.deepEqual(json.errors, []);

            assert.deepEqual(json.layers.map(l => [l.id, l.index, l.inJson]), [["layer1", 0, true], ["layer2", 1, true]]);
            for (const layer of json.layers) {
                assert.equal(typeof layer.label, "string");
            }

            assert.equal(json.frames.length, 2);
            const [f0, f1] = json.frames;
            assert.equal(f0.index, 0);
            assert.equal(f0.id, "frame1");
            assert.equal(f0.title, "One");
            assert.equal(f1.index, 1);
            for (const frame of json.frames) {
                for (const key of ["timeoutMs", "timeoutEnable", "transitionDurationMs", "showInFrameList"]) {
                    assert.ok(key in frame, key);
                }
                assert.deepEqual(Object.keys(frame.layers).sort(), ["layer1", "layer2"]);
                for (const layer of Object.values(frame.layers)) {
                    for (const key of ["referenceElementId", "referenceMissing", "outlineElementId", "link", "camera"]) {
                        assert.ok(key in layer, key);
                    }
                    assert.deepEqual(Object.keys(layer.camera).sort(), ["angle", "clipped", "cx", "cy", "height", "opacity", "width"]);
                }
            }
            assert.equal(f0.layers.layer1.referenceElementId, "r1");
            assert.equal(f0.layers.layer1.referenceMissing, false);
            assert.equal(f0.layers.layer1.camera.cx, 210);
            assert.equal(f1.layers.layer2.referenceElementId, "r2");
        }
        finally {
            deck.cleanup();
        }
    });

    test("flags a reference element that is not in the SVG", () => {
        const deck = withTempDeck("basic");
        try {
            const data = JSON.parse(fs.readFileSync(deck.json, "utf8"));
            data.frames[0].layerProperties.layer2.referenceElementId = "nope";
            fs.writeFileSync(deck.json, JSON.stringify(data, null, 2));
            const {code, json} = inspect(deck);
            assert.equal(code, 0, JSON.stringify(json));
            assert.equal(json.frames[0].layers.layer2.referenceElementId, "nope");
            assert.equal(json.frames[0].layers.layer2.referenceMissing, true);
            assert.equal(json.frames[0].layers.layer1.referenceMissing, false);
        }
        finally {
            deck.cleanup();
        }
    });

    test("--frame 1 returns that frame only", () => {
        const deck = withTempDeck("basic");
        try {
            const {code, json} = inspect(deck, "--frame", "1");
            assert.equal(code, 0, JSON.stringify(json));
            assert.equal(json.frames.length, 1);
            assert.equal(json.frames[0].index, 1);
        }
        finally {
            deck.cleanup();
        }
    });

    test("--frame accepts a frame id", () => {
        const deck = withTempDeck("basic");
        try {
            const {code, json} = inspect(deck, "--frame=frame1");
            assert.equal(code, 0, JSON.stringify(json));
            assert.deepEqual(json.frames.map(f => f.id), ["frame1"]);
            assert.equal(json.frames[0].index, 0);
        }
        finally {
            deck.cleanup();
        }
    });

    test("--frame 9 exits 1", () => {
        const deck = withTempDeck("basic");
        try {
            const {code, json} = inspect(deck, "--frame", "9");
            assert.equal(code, 1);
            assert.equal(json.ok, false);
            assert.match(json.error, /frame not found: 9/);
            assert.equal(json.command, "inspect");
        }
        finally {
            deck.cleanup();
        }
    });

    test("--frame with no value exits 2", () => {
        const deck = withTempDeck("basic");
        try {
            for (const args of [["inspect", "basic.svg", "--frame"], ["inspect", "--frame", "--size", "640x480", "basic.svg"]]) {
                const {code, json} = runSozi(args, {cwd: deck.dir});
                assert.equal(code, 2, args.join(" "));
                assert.equal(json.ok, false);
                assert.equal(json.error, "missing value for --frame");
                assert.match(json.usage, /^sozi --cli/);
            }
        }
        finally {
            deck.cleanup();
        }
    });

    test("creates and modifies no files", () => {
        const deck = withTempDeck("basic");
        try {
            const past = new Date(Date.now() - 3600 * 1000);
            for (const file of fs.readdirSync(deck.dir)) {
                fs.utimesSync(path.join(deck.dir, file), past, past);
            }
            const before = snapshot(deck.dir);
            const {code} = inspect(deck);
            assert.equal(code, 0);
            assert.deepEqual(snapshot(deck.dir), before);
        }
        finally {
            deck.cleanup();
        }
    });

    test("reports every SVG layer, inJson false without a JSON file", () => {
        const deck = withTempDeck("basic");
        try {
            fs.rmSync(deck.json);
            const before = snapshot(deck.dir);
            const {code, json} = inspect(deck);
            assert.equal(code, 0, JSON.stringify(json));
            assert.deepEqual(json.frames, []);
            assert.deepEqual(json.layers.map(l => [l.id, l.inJson]), [["layer1", false], ["layer2", false]]);
            assert.deepEqual(snapshot(deck.dir), before);
        }
        finally {
            deck.cleanup();
        }
    });

    test("reports the auto layer when the SVG has top-level groups without an id", () => {
        const deck = withTempDeck("basic");
        try {
            const svg = fs.readFileSync(deck.svg, "utf8")
                .replace("</svg>", "  <g><rect id=\"r3\" x=\"0\" y=\"0\" width=\"10\" height=\"10\" /></g>\n</svg>");
            fs.writeFileSync(deck.svg, svg);
            const {code, json} = inspect(deck);
            assert.equal(code, 0, JSON.stringify(json));
            assert.deepEqual(json.layers.map(l => [l.id, l.index, l.inJson]),
                [["layer1", 0, true], ["layer2", 1, true], ["__sozi_auto__", 2, false]]);
            assert.deepEqual(Object.keys(json.frames[0].layers), ["layer1", "layer2", "__sozi_auto__"]);
        }
        finally {
            deck.cleanup();
        }
    });

    test("inspects the Sozi website deck", () => {
        const deck = withTempDeck("website");
        try {
            const {code, json, stderr} = inspect(deck);
            assert.equal(code, 0, `${JSON.stringify(json).slice(0, 500)}\n${stderr}`);
            assert.equal(json.frames.length, 9);
            assert.ok(json.layers.length > 0);
        }
        finally {
            deck.cleanup();
        }
    });
});

describe("runner errors", () => {
    test("missing file argument exits 2", () => {
        const {code, json} = runSozi(["inspect"]);
        assert.equal(code, 2);
        assert.equal(json.ok, false);
        assert.match(json.error, /missing file argument/);
        assert.equal(json.command, "inspect");
        assert.deepEqual(json.errors, []);
    });

    test("a file without extension exits 2 before loading", () => {
        const deck = withTempDeck("basic");
        try {
            const bare = path.join(deck.dir, "basic");
            fs.copyFileSync(deck.svg, bare);
            const before = snapshot(deck.dir);
            const {code, json} = runSozi(["inspect", "basic"], {cwd: deck.dir});
            assert.equal(code, 2);
            assert.equal(json.ok, false);
            assert.match(json.error, /extension/);
            assert.equal(json.svg, bare);
            assert.deepEqual(snapshot(deck.dir), before);
        }
        finally {
            deck.cleanup();
        }
    });

    test("an error reported through the controller exits 1 and is listed in errors", () => {
        const deck = withTempDeck("basic");
        try {
            fs.writeFileSync(deck.svg, "this is not svg");
            const {code, json} = inspect(deck);
            assert.equal(code, 1);
            assert.equal(json.ok, false);
            assert.equal(json.errors.length, 1);
            assert.match(json.errors[0], /not valid SVG/);
            assert.equal(json.error, json.errors[0]);
        }
        finally {
            deck.cleanup();
        }
    });
});
