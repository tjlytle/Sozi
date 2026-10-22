import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {builtModule} from "./support/stubs.js";

const {upgradeFromStorable} = await builtModule("upgrade.js");

const fixture = JSON.parse(
    fs.readFileSync(new URL("../fixtures/basic.sozi.json", import.meta.url), "utf8")
);

describe("upgradeFromStorable", () => {
    test("leaves a current-format file unchanged", () => {
        const storable = structuredClone(fixture);
        upgradeFromStorable(storable);
        assert.deepEqual(storable, fixture);
    });

    test("replaces referenceElementHide with outlineElementHide", () => {
        const storable = {frames: [{layerProperties: {g: {referenceElementHide: true}}}]};
        upgradeFromStorable(storable);
        assert.deepEqual(storable.frames[0].layerProperties.g, {outlineElementHide: true});
    });

    test("removes referenceElementAuto", () => {
        const storable = {
            frames: [{layerProperties: {g: {referenceElementAuto: true, link: false}}}]
        };
        upgradeFromStorable(storable);
        assert.deepEqual(storable.frames[0].layerProperties.g, {link: false});
    });

    test("copies referenceElementId to outlineElementId only when the latter is absent", () => {
        const storable = {
            frames: [
                {
                    layerProperties: {
                        a: {referenceElementId: "r1"},
                        b: {referenceElementId: "r2", outlineElementId: "o2"},
                        c: {referenceElementId: "r3", outlineElementId: ""}
                    }
                }
            ]
        };
        upgradeFromStorable(storable);
        const lp = storable.frames[0].layerProperties;
        assert.equal(lp.a.outlineElementId, "r1");
        assert.equal(lp.b.outlineElementId, "o2");
        assert.equal(lp.c.outlineElementId, "");
        assert.equal(lp.a.referenceElementId, "r1");
    });

    test("migrates every layer of every frame", () => {
        const storable = {
            frames: [
                {
                    layerProperties: {
                        a: {referenceElementHide: true},
                        b: {referenceElementHide: false}
                    }
                },
                {layerProperties: {a: {referenceElementHide: false}}}
            ]
        };
        upgradeFromStorable(storable);
        assert.deepEqual(
            storable.frames.map(f =>
                Object.values(f.layerProperties).map(l => l.outlineElementHide)
            ),
            [[true, false], [false]]
        );
    });

    test("is idempotent", () => {
        const storable = {
            frames: [
                {
                    layerProperties: {
                        g: {
                            referenceElementHide: true,
                            referenceElementAuto: false,
                            referenceElementId: "r"
                        }
                    }
                }
            ]
        };
        upgradeFromStorable(storable);
        const once = structuredClone(storable);
        upgradeFromStorable(storable);
        assert.deepEqual(storable, once);
    });

    test("throws when the file has no frames array", () => {
        assert.throws(() => upgradeFromStorable({}), TypeError);
    });
});
