import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    NARROW_MAX_WIDTH,
    isNarrow,
    layoutKey,
    readSavedLayout,
    savedLayoutText
} from "../../../src/js/presenter/layout.js";

const knownIds = ["current", "notes", "next"];

// The parts of dockview's toJSON that the layout module looks at.
const dock = {
    grid: {root: {type: "branch", data: []}, width: 800, height: 600, orientation: "HORIZONTAL"},
    panels: {current: {id: "current"}, notes: {id: "notes"}}
};
const rail = [{id: "next", group: "2"}];

describe("presenter layout", () => {
    test("each deck has its own key, from its page's path", () => {
        assert.equal(
            layoutKey("/talks/a-presenter.sozi.html"),
            "sozi-presenter-layout:/talks/a-presenter.sozi.html"
        );
        assert.notEqual(layoutKey("/a/x.html"), layoutKey("/b/x.html"));
    });

    test("a saved layout reads back as it was saved", () => {
        assert.deepEqual(readSavedLayout(savedLayoutText(dock, rail), knownIds), {dock, rail});
    });

    test("a rail panel may have lost its group", () => {
        const lost = [{id: "next", group: null}];
        assert.deepEqual(readSavedLayout(savedLayoutText(dock, lost), knownIds), {
            dock,
            rail: lost
        });
    });

    test("text that is not JSON is refused", () => {
        assert.equal(readSavedLayout("{not json", knownIds), null);
        assert.equal(readSavedLayout("", knownIds), null);
        assert.equal(readSavedLayout("null", knownIds), null);
        assert.equal(readSavedLayout("[]", knownIds), null);
    });

    test("a version other than 1 is refused", () => {
        const text = savedLayoutText(dock, rail);
        for (const version of [0, 2, "1", undefined]) {
            assert.equal(
                readSavedLayout(JSON.stringify({...JSON.parse(text), version}), knownIds),
                null,
                String(version)
            );
        }
    });

    test("an unknown panel id is refused, in the dock or on the rail", () => {
        const strange = {...dock, panels: {...dock.panels, clock: {id: "clock"}}};
        assert.equal(readSavedLayout(savedLayoutText(strange, rail), knownIds), null);
        assert.equal(
            readSavedLayout(savedLayoutText(dock, [...rail, {id: "clock", group: "1"}]), knownIds),
            null
        );
    });

    test("a panel that is neither docked nor on the rail is refused", () => {
        assert.equal(readSavedLayout(savedLayoutText(dock, []), knownIds), null);
    });

    test("a panel both docked and on the rail is refused", () => {
        const twice = [...rail, {id: "notes", group: "1"}];
        assert.equal(readSavedLayout(savedLayoutText(dock, twice), knownIds), null);
    });

    test("a malformed dock or rail is refused", () => {
        // Casts: these rails are malformed on purpose.
        const bad = [
            savedLayoutText(null, rail),
            savedLayoutText({panels: dock.panels}, rail),
            savedLayoutText({grid: dock.grid}, rail),
            savedLayoutText(dock, /** @type {any} */ (null)),
            savedLayoutText(dock, /** @type {any} */ ([{id: "next"}])),
            savedLayoutText(dock, /** @type {any} */ ([{id: "next", group: 2}]))
        ];
        for (const text of bad) {
            assert.equal(readSavedLayout(text, knownIds), null, text);
        }
    });

    test("a page is narrow up to 600 pixels wide", () => {
        assert.equal(NARROW_MAX_WIDTH, 600);
        assert.equal(isNarrow(390), true);
        assert.equal(isNarrow(600), true);
        assert.equal(isNarrow(601), false);
        assert.equal(isNarrow(1280), false);
    });
});
