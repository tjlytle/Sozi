import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {builtModule} from "../support/stubs.js";

const {Presentation} = await builtModule("model/Presentation.js");

const fixture = JSON.parse(
    fs.readFileSync(new URL("../../fixtures/basic.sozi.json", import.meta.url), "utf8")
);

/** Load the basic fixture into a presentation without an SVG document.
 *
 * @returns {any} - A presentation with no layers.
 */
function loadBasic() {
    const presentation = new Presentation();
    presentation.fromStorable(structuredClone(fixture));
    return presentation;
}

describe("Presentation", () => {
    test("a new presentation has the documented defaults", () => {
        const presentation = new Presentation();
        assert.deepEqual(presentation.frames, []);
        assert.deepEqual(presentation.layers, []);
        assert.equal(presentation.aspectWidth, 4);
        assert.equal(presentation.aspectHeight, 3);
        assert.equal(presentation.exportType, "pdf");
        assert.equal(presentation.title, "Untitled");
    });

    test("fromStorable of the basic fixture gives two frames titled One and Two", () => {
        const presentation = loadBasic();
        assert.deepEqual(
            presentation.frames.map(f => f.title),
            ["One", "Two"]
        );
        assert.deepEqual(
            presentation.frames.map(f => f.frameId),
            ["frame1", "frame2"]
        );
        assert.equal(presentation.aspectWidth, 16);
        assert.equal(presentation.aspectHeight, 9);
    });

    test("toStorable after fromStorable equals the fixture except the editor keys and the per-layer maps", () => {
        const out = loadBasic().toStorable();
        const expected = structuredClone(fixture);
        // The selection and editable layers belong to the editor, not to the presentation.
        delete expected.selectedFrames;
        delete expected.selectedLayers;
        delete expected.editableLayers;
        // Without an SVG document there are no layers, so no per-layer state survives.
        for (const frame of expected.frames) {
            frame.layerProperties = {};
            frame.cameraStates = {};
            frame.cameraOffsets = {};
        }
        assert.deepEqual(out, expected);
    });

    test("title, svg and outputDir keys are stored only when set, and bad types are reported", () => {
        const presentation = new Presentation();
        presentation.fromStorable({title: "Talk", svg: "a.svg", outputDir: "  out  ", frames: []});
        const out = presentation.toStorable();
        assert.equal(out.title, "Talk");
        assert.equal(out.svg, "a.svg");
        assert.equal(out.outputDir, "out");
        assert.equal(presentation.title, "Talk");

        const bad = new Presentation();
        bad.fromStorable({title: 3, svg: 4, outputDir: 5, frames: []});
        assert.deepEqual(bad.ignoredStorableKeys, ["title", "svg", "outputDir"]);
        assert.ok(!("title" in bad.toStorable()));
    });

    test("toMinimalStorable keeps only what the player needs", () => {
        const out = loadBasic().toMinimalStorable();
        assert.equal(out.frames.length, 2);
        assert.ok(!("exportType" in out));
        assert.ok(!("aspectWidth" in out));
        assert.equal(out.enableMouseZoom, true);
    });

    test("makeFrameId gives ids that are unique over 100 calls", () => {
        const presentation = loadBasic();
        const ids = new Set(presentation.frames.map(f => f.frameId));
        for (let i = 0; i < 100; i++) {
            const id = presentation.makeFrameId();
            assert.match(id, /^frame\d+$/);
            assert.ok(!ids.has(id));
            ids.add(id);
            presentation.frames.push({frameId: id});
        }
        assert.equal(ids.size, 102);
    });

    test("getFrameWithId finds a frame and misses with null", () => {
        const presentation = loadBasic();
        assert.equal(presentation.getFrameWithId("frame2"), presentation.frames[1]);
        assert.equal(presentation.getFrameWithId("nope"), null);
        assert.equal(presentation.getLayerWithId("layer1"), null);
    });

    test("getCustomFiles filters by extension", () => {
        const presentation = new Presentation();
        presentation.fromStorable({frames: [], customFiles: ["a.js", "b.css", "c/d.js"]});
        assert.deepEqual(presentation.getCustomFiles(".js"), ["a.js", "c/d.js"]);
        assert.deepEqual(presentation.getCustomFiles(".png"), []);
    });

    test("updateLinkedLayers does nothing without frames", () => {
        assert.doesNotThrow(() => new Presentation().updateLinkedLayers());
    });
});
