import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {isPresetName, readPreset, readPresets} from "../../../src/js/protocol/layoutPresets.js";

const dock = {grid: {root: {}}, panels: {current: {id: "current"}}};
const layout = {version: 1, dock, rail: [{id: "notes", group: "2"}]};

describe("layout presets", () => {
    test("a name starts with a letter and holds letters, digits, _ and -", () => {
        for (const name of ["phone", "Wide2", "my_talk", "my-talk"]) {
            assert.equal(isPresetName(name), true, name);
        }
    });

    test("a name that JSON would reorder or that is not a plain word is refused", () => {
        for (const name of ["", "1", "1a", "a.b", "a b", "__proto__", "-a", 1, null, undefined]) {
            assert.equal(isPresetName(name), false, String(name));
        }
    });

    test("a preset reads back with each kind of match", () => {
        for (const match of ["phone", "laptop", {minWidth: 1600}, {minWidth: 0}]) {
            assert.deepEqual(readPreset({match, layout}), {match, layout});
        }
    });

    test("a preset keeps only its own fields", () => {
        const extra = {match: "phone", layout: {...layout, more: 1}, more: 1};
        assert.deepEqual(readPreset(extra), {match: "phone", layout});
    });

    test("a version this surface does not know still reads: the surface refuses it", () => {
        const later = {...layout, version: 2};
        assert.deepEqual(readPreset({match: "phone", layout: later}), {
            match: "phone",
            layout: later
        });
    });

    test("each malformed shape is refused", () => {
        const bad = [
            null,
            "phone",
            [],
            {layout},
            {match: "phone"},
            {match: "tablet", layout},
            {match: {}, layout},
            {match: {minWidth: "1"}, layout},
            {match: {minWidth: -1}, layout},
            {match: {minWidth: Infinity}, layout},
            {match: "phone", layout: null},
            {match: "phone", layout: {...layout, version: "1"}},
            {match: "phone", layout: {...layout, dock: null}},
            {match: "phone", layout: {...layout, dock: {panels: dock.panels}}},
            {match: "phone", layout: {...layout, dock: {grid: dock.grid}}},
            {match: "phone", layout: {...layout, rail: null}},
            {match: "phone", layout: {...layout, rail: [{id: "notes"}]}},
            {match: "phone", layout: {...layout, rail: [{id: 1, group: null}]}}
        ];
        for (const value of bad) {
            assert.equal(readPreset(value), null, JSON.stringify(value));
        }
    });

    test("the valid presets are kept in the file's order", () => {
        const value = {z: {match: "phone", layout}, a: {match: "laptop", layout}};
        const {presets, ignored} = readPresets(value);
        assert.deepEqual(Object.keys(presets), ["z", "a"]);
        assert.deepEqual(ignored, []);
    });

    test("an invalid name or preset is listed as ignored and the others stay", () => {
        const value = JSON.parse(
            `{"good": {"match": "phone", "layout": ${JSON.stringify(layout)}},
              "bad": {"match": "tablet"},
              "a.b": {"match": "phone", "layout": ${JSON.stringify(layout)}},
              "__proto__": {"match": "phone", "layout": ${JSON.stringify(layout)}},
              "1": {"match": "phone", "layout": ${JSON.stringify(layout)}}}`
        );
        const {presets, ignored} = readPresets(value);
        assert.deepEqual(Object.keys(presets), ["good"]);
        assert.deepEqual([...ignored].sort(), ["1", "__proto__", "a.b", "bad"]);
    });

    test("anything but an object holds no presets", () => {
        for (const value of [undefined, null, "layouts", 3, []]) {
            assert.deepEqual(readPresets(value), {presets: {}, ignored: []});
        }
    });
});
