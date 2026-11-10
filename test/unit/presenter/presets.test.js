import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    matchForWidth,
    matches,
    pickPreset,
    presetFileName,
    presetFileText,
    setCommand
} from "../../../src/js/presenter/presets.js";

const knownIds = ["current", "notes"];

/** A layout that has these panels docked.
 *
 * @param {string[]} ids - The panels.
 * @returns {object} - The layout.
 */
function layoutOf(ids) {
    const panels = Object.fromEntries(ids.map(id => [id, {id}]));
    return {version: 1, dock: {grid: {}, panels}, rail: []};
}

/** Choose from presets written out in a test.
 *
 * @param {any} presets - The presets.
 * @param {number} width - The page's width.
 * @param {string[]} ids - The surface's panels.
 * @param {string[]} [failed] - The presets the caller could not show.
 * @returns {any} - The choice.
 */
function pickFrom(presets, width, ids, failed) {
    return pickPreset(presets, width, ids, failed);
}

const usable = layoutOf(knownIds);
const strange = layoutOf(["current", "clock"]);

describe("layout preset choice", () => {
    test("phone means up to 600 pixels, laptop wider than that", () => {
        assert.equal(matches("phone", 600), true);
        assert.equal(matches("phone", 601), false);
        assert.equal(matches("laptop", 600), false);
        assert.equal(matches("laptop", 601), true);
    });

    test("minWidth means at least so many pixels", () => {
        assert.equal(matches({minWidth: 1600}, 1599), false);
        assert.equal(matches({minWidth: 1600}, 1600), true);
    });

    test("a form starts on the page's own width class", () => {
        assert.equal(matchForWidth(600), "phone");
        assert.equal(matchForWidth(601), "laptop");
    });

    test("the first preset that matches wins, in file order", () => {
        const presets = {
            wide: {match: {minWidth: 1600}, layout: usable},
            laptop: {match: "laptop", layout: layoutOf(["notes", "current"])}
        };
        assert.deepEqual(pickFrom(presets, 1920, knownIds), {
            name: "wide",
            layout: {dock: usable.dock, rail: []},
            refused: []
        });
        assert.equal(pickFrom(presets, 1280, knownIds).name, "laptop");
    });

    test("no preset that matches gives nothing", () => {
        const presets = {phone: {match: "phone", layout: usable}};
        assert.deepEqual(pickFrom(presets, 1280, knownIds), {
            name: null,
            layout: null,
            refused: []
        });
        assert.equal(pickFrom({}, 1280, knownIds).name, null);
    });

    test("an unusable preset falls through to the next match, and is named", () => {
        const presets = {
            first: {match: "laptop", layout: strange},
            second: {match: "laptop", layout: {...usable, version: 2}},
            third: {match: "laptop", layout: usable}
        };
        const pick = pickFrom(presets, 1280, knownIds);
        assert.equal(pick.name, "third");
        assert.deepEqual(pick.refused, ["first", "second"]);
    });

    test("a preset that does not match is not refused, however unusable", () => {
        const presets = {phone: {match: "phone", layout: strange}};
        assert.deepEqual(pickFrom(presets, 1280, knownIds).refused, []);
    });

    test("a preset the caller could not show is skipped without being named again", () => {
        const presets = {
            first: {match: "laptop", layout: usable},
            second: {match: "laptop", layout: usable}
        };
        const pick = pickFrom(presets, 1280, knownIds, ["first"]);
        assert.equal(pick.name, "second");
        assert.deepEqual(pick.refused, []);
    });

    test("the file is named after the deck and the preset", () => {
        assert.equal(presetFileName("talk", "mine"), "talk.mine.layout.json");
    });

    test("the file holds the match and the layout, which read back as a preset", () => {
        const preset = JSON.parse(presetFileText({minWidth: 900}, usable));
        assert.deepEqual(preset, {match: {minWidth: 900}, layout: usable});
    });

    test("the command names the deck, the preset and the file", () => {
        assert.equal(
            setCommand("talk", "mine", "talk.mine.layout.json"),
            "sozi --cli set talk.sozi.json --layout mine=talk.mine.layout.json"
        );
    });

    test("the command quotes a deck name the shell would split", () => {
        assert.equal(
            setCommand("my talk", "mine", "my talk.mine.layout.json"),
            "sozi --cli set 'my talk.sozi.json' --layout 'mine=my talk.mine.layout.json'"
        );
    });
});
