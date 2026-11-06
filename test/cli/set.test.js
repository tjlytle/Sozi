/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {runSozi, withTempDeck} = require("./helpers.js");

/** @typedef {import("./helpers.js").Deck} Deck */
/** @typedef {import("./helpers.js").SoziRun} SoziRun */

const dock = {grid: {root: {}}, panels: {current: {id: "current"}}};
const layout = {version: 1, dock, rail: []};

/**
 * Run `set --layout` on a temp deck.
 *
 * @param {Deck} deck - A temp deck from `withTempDeck`.
 * @param {string} value - The value of `--layout`.
 * @returns {SoziRun} - The result of the run.
 */
function setLayout(deck, value) {
    const json = path.basename(deck.json);
    return runSozi(["set", json, "--layout", value], {cwd: deck.dir});
}

/**
 * Write a file in a temp deck's directory.
 *
 * @param {Deck} deck - The deck.
 * @param {string} name - The file's name.
 * @param {any} content - What the file holds, as JSON unless it is a string.
 * @returns {string} - The name.
 */
function writeFile(deck, name, content) {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    fs.writeFileSync(path.join(deck.dir, name), text);
    return name;
}

/**
 * The stored form of a deck.
 *
 * @param {Deck} deck - The deck.
 * @returns {any} - The content of its JSON file.
 */
function stored(deck) {
    return JSON.parse(fs.readFileSync(deck.json, "utf8"));
}

/**
 * Run a test on a temp copy of a fixture.
 *
 * @param {string} fixture - The fixture's name.
 * @param {(deck: Deck) => void} body - The test.
 */
function onDeck(fixture, body) {
    const deck = withTempDeck(fixture);
    try {
        body(deck);
    } finally {
        deck.cleanup();
    }
}

describe("set --layout", () => {
    test("adds a preset last", () => {
        onDeck("layouts", deck => {
            const file = writeFile(deck, "mine.json", {match: "laptop", layout});
            const {code, json, stderr} = setLayout(deck, `mine=${file}`);
            assert.equal(code, 0, `${JSON.stringify(json)}\n${stderr}`);
            assert.ok(json.changed.layout);
            const {layouts} = stored(deck).presenter;
            assert.deepEqual(Object.keys(layouts), ["wide", "phone", "laptop", "mine"]);
            assert.deepEqual(layouts.mine, {match: "laptop", layout});
        });
    });

    test("adds the first preset of a deck that has none", () => {
        onDeck("basic", deck => {
            const file = writeFile(deck, "mine.json", {match: {minWidth: 900}, layout});
            assert.equal(setLayout(deck, `mine=${file}`).code, 0);
            assert.deepEqual(stored(deck).presenter.layouts, {
                mine: {match: {minWidth: 900}, layout}
            });
        });
    });

    test("replaces a preset in its place", () => {
        onDeck("layouts", deck => {
            const file = writeFile(deck, "new.json", {match: "phone", layout});
            assert.equal(setLayout(deck, `phone=${file}`).code, 0);
            const {layouts} = stored(deck).presenter;
            assert.deepEqual(Object.keys(layouts), ["wide", "phone", "laptop"]);
            assert.deepEqual(layouts.phone.layout, layout);
        });
    });

    test("removes a preset, and the presenter key with the last one", () => {
        onDeck("layouts-unknown-panel", deck => {
            const {code, json} = setLayout(deck, "laptop=");
            assert.equal(code, 0, JSON.stringify(json));
            assert.equal(Object.hasOwn(stored(deck), "presenter"), false);
        });
    });

    test("reports nothing when nothing changes, and leaves the file alone", () => {
        onDeck("layouts", deck => {
            const preset = stored(deck).presenter.layouts.phone;
            const file = writeFile(deck, "same.json", preset);
            const before = fs.readFileSync(deck.json);
            for (const value of [`phone=${file}`, "absent="]) {
                const {code, json} = setLayout(deck, value);
                assert.equal(code, 0, JSON.stringify(json));
                assert.deepEqual(json.changed, {}, value);
            }
            assert.deepEqual(fs.readFileSync(deck.json), before);
        });
    });

    test("reads the file relative to the working directory", () => {
        onDeck("basic", deck => {
            fs.mkdirSync(path.join(deck.dir, "sub"));
            writeFile(deck, "sub/mine.json", {match: "phone", layout});
            assert.equal(setLayout(deck, "mine=sub/mine.json").code, 0);
            assert.ok(stored(deck).presenter.layouts.mine);
        });
    });

    test("each bad input exits 2 and writes nothing", () => {
        onDeck("basic", deck => {
            const good = writeFile(deck, "good.json", {match: "phone", layout});
            const notJson = writeFile(deck, "not.json", "{not json");
            const badPreset = writeFile(deck, "bad.json", {match: "tablet", layout});
            const before = fs.readFileSync(deck.json);
            const bad = [
                ["no-equals", /NAME=FILE/],
                [`=${good}`, /preset name/],
                [`1a=${good}`, /preset name/],
                [`a.b=${good}`, /preset name/],
                [`__proto__=${good}`, /preset name/],
                ["mine=missing.json", /missing\.json/],
                [`mine=${notJson}`, /not\.json/],
                [`mine=${badPreset}`, /bad\.json/]
            ];
            for (const [value, error] of bad) {
                const {code, json} = setLayout(deck, /** @type {string} */ (value));
                assert.equal(code, 2, `${value}: ${JSON.stringify(json)}`);
                assert.equal(json.ok, false);
                assert.match(json.error, /** @type {RegExp} */ (error));
            }
            assert.deepEqual(fs.readFileSync(deck.json), before);
        });
    });

    test("--layout is not stored by build", () => {
        onDeck("basic", deck => {
            const file = writeFile(deck, "mine.json", {match: "phone", layout});
            const run = runSozi(["build", "--layout", `mine=${file}`, path.basename(deck.svg)], {
                cwd: deck.dir
            });
            assert.equal(run.code, 2, run.stdout);
        });
    });

    test("a deck with no presets gets no presenter key", () => {
        onDeck("basic", deck => {
            const run = runSozi(["set", "--title", "New", path.basename(deck.svg)], {
                cwd: deck.dir
            });
            assert.equal(run.code, 0, run.stdout);
            assert.equal(Object.hasOwn(stored(deck), "presenter"), false);
        });
    });
});
