import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {closedItems, panelChoices, presetChoices} from "../../../src/js/presenter/arrangement.js";

/**
 * A panel as the workspace holds it.
 *
 * @param {string} id - Its id.
 * @param {string} [description] - Its description.
 * @returns {object} The panel.
 */
function panel(id, description = "") {
    return {id, title: id.toUpperCase(), icon: id.charAt(0), description, render() {}};
}

const PANELS = [panel("current"), panel("notes", "What to say"), panel("clock"), panel("next")];
const IDS = PANELS.map(p => p.id);

/**
 * A preset whose layout docks every panel.
 *
 * @param {any} match - Which pages it is for.
 * @param {object} [panels] - The dock's panels.
 * @returns {object} The preset.
 */
function preset(match, panels = {current: {id: "current"}}) {
    return {match, layout: {version: 1, dock: {grid: {}, panels}, rail: []}};
}

describe("arrangement", () => {
    test("the + menu lists the panels not showing, in the order they were registered", () => {
        assert.deepEqual(closedItems(PANELS, ["notes", "current"]), [
            {id: "clock", title: "CLOCK", icon: "c", description: ""},
            {id: "next", title: "NEXT", icon: "n", description: ""}
        ]);
    });

    test("with every panel showing, the + menu lists nothing", () => {
        assert.deepEqual(closedItems(PANELS, IDS), []);
    });

    test("Replace and Split offer every panel but the one whose menu it is", () => {
        assert.deepEqual(
            panelChoices(PANELS, "clock").map(p => p.id),
            ["current", "notes", "next"]
        );
        assert.equal(panelChoices(PANELS, "notes")[0].description, "");
        assert.equal(panelChoices(PANELS, "clock")[1].description, "What to say");
    });

    test("the Layouts menu lists the presets for this width, then Default", () => {
        const presets = {
            phone: preset("phone"),
            laptop: preset("laptop"),
            wide: preset({minWidth: 1600})
        };
        assert.deepEqual(
            presetChoices(presets, 1280, IDS).map(c => c.name),
            ["laptop", "Default"]
        );
        assert.deepEqual(
            presetChoices(presets, 1920, IDS).map(c => c.name),
            ["laptop", "wide", "Default"]
        );
        assert.deepEqual(
            presetChoices(presets, 390, IDS).map(c => c.name),
            ["phone", "Default"]
        );
    });

    test("a preset is chosen with its layout, read, and Default with none", () => {
        const [laptop, fallback] = presetChoices({laptop: preset("laptop")}, 1280, IDS);
        assert.deepEqual(laptop.layout, {
            dock: {grid: {}, panels: {current: {id: "current"}}},
            rail: []
        });
        assert.deepEqual(fallback, {name: "Default", layout: null});
    });

    test("a preset this page cannot read is not listed", () => {
        const unknown = preset("laptop", {stranger: {id: "stranger"}});
        assert.deepEqual(
            presetChoices({unknown}, 1280, IDS).map(c => c.name),
            ["Default"]
        );
    });
});
