import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {Selection} from "../../../src/js/model/Selection.js";

/** Create a presentation stub with frames and layers.
 *
 * @returns {any} - An object with the members that `Selection` reads.
 */
function stubPresentation() {
    const frames = ["f1", "f2", "f3"].map(frameId => ({frameId}));
    const layers = ["g1", "g2"].map(groupId => ({groupId}));
    return {
        frames,
        layers,
        on() {},
        getFrameWithId: id => frames.find(f => f.frameId === id) || null,
        getLayerWithId: id => layers.find(l => l.groupId === id) || null
    };
}

describe("Selection", () => {
    test("starts empty, with no current frame", () => {
        const selection = new Selection(stubPresentation());
        assert.deepEqual(selection.selectedFrames, []);
        assert.deepEqual(selection.selectedLayers, []);
        assert.equal(selection.currentFrame, null);
    });

    test("addFrame ignores duplicates; the current frame is the last one added", () => {
        const pres = stubPresentation();
        const selection = new Selection(pres);
        selection.addFrame(pres.frames[0]);
        selection.addFrame(pres.frames[2]);
        selection.addFrame(pres.frames[0]);
        assert.deepEqual(selection.selectedFrames, [pres.frames[0], pres.frames[2]]);
        assert.equal(selection.currentFrame, pres.frames[2]);
    });

    test("removeFrame removes a selected frame and ignores others", () => {
        const pres = stubPresentation();
        const selection = new Selection(pres);
        selection.addFrame(pres.frames[0]);
        selection.removeFrame(pres.frames[1]);
        assert.equal(selection.selectedFrames.length, 1);
        selection.removeFrame(pres.frames[0]);
        assert.equal(selection.selectedFrames.length, 0);
    });

    test("toggleFrameSelection adds then removes", () => {
        const pres = stubPresentation();
        const selection = new Selection(pres);
        selection.toggleFrameSelection(pres.frames[1]);
        assert.deepEqual(selection.selectedFrames, [pres.frames[1]]);
        selection.toggleFrameSelection(pres.frames[1]);
        assert.deepEqual(selection.selectedFrames, []);
    });

    test("hasFrames is true only when every given frame is selected (and for an empty list)", () => {
        const pres = stubPresentation();
        const selection = new Selection(pres);
        selection.addFrame(pres.frames[0]);
        selection.addFrame(pres.frames[1]);
        assert.ok(selection.hasFrames([pres.frames[0], pres.frames[1]]));
        assert.ok(!selection.hasFrames([pres.frames[0], pres.frames[2]]));
        assert.ok(selection.hasFrames([]));
    });

    test("layers: add, remove, toggle and hasLayers", () => {
        const pres = stubPresentation();
        const selection = new Selection(pres);
        selection.addLayer(pres.layers[0]);
        selection.addLayer(pres.layers[0]);
        assert.deepEqual(selection.selectedLayers, [pres.layers[0]]);
        selection.toggleLayerSelection(pres.layers[1]);
        assert.ok(selection.hasLayers(pres.layers));
        selection.toggleLayerSelection(pres.layers[1]);
        selection.removeLayer(pres.layers[0]);
        assert.deepEqual(selection.selectedLayers, []);
        assert.ok(!selection.hasLayers(pres.layers));
    });

    test("toStorable and fromStorable round trip through ids", () => {
        const pres = stubPresentation();
        const selection = new Selection(pres);
        selection.addFrame(pres.frames[2]);
        selection.addFrame(pres.frames[0]);
        selection.addLayer(pres.layers[1]);
        const storable = selection.toStorable();
        assert.deepEqual(storable, {selectedFrames: ["f3", "f1"], selectedLayers: ["g2"]});

        const restored = new Selection(pres);
        restored.fromStorable(JSON.parse(JSON.stringify(storable)));
        assert.deepEqual(restored.selectedFrames, [pres.frames[2], pres.frames[0]]);
        assert.deepEqual(restored.selectedLayers, [pres.layers[1]]);
    });

    test("fromStorable skips unknown ids and leaves absent keys untouched", () => {
        const pres = stubPresentation();
        const selection = new Selection(pres);
        selection.addLayer(pres.layers[0]);
        selection.fromStorable({selectedFrames: ["f2", "nope"]});
        assert.deepEqual(selection.selectedFrames, [pres.frames[1]]);
        assert.deepEqual(selection.selectedLayers, [pres.layers[0]]);
    });
});
