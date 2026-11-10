import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    NARROW_MAX_WIDTH,
    dockedLayout,
    isNarrow,
    layoutKey,
    layoutOf,
    layoutSource,
    readLayout,
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

    test("a panel that is neither docked nor on the rail is not a reason to refuse", () => {
        // The workspace adds it at its default place: a new panel must not cost a saved layout.
        assert.deepEqual(readSavedLayout(savedLayoutText(dock, []), knownIds), {dock, rail: []});
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

    test("a narrow page has a slot of its own, in the deck's key space", () => {
        const path = "/talks/a-presenter.sozi.html";
        assert.equal(layoutKey(path, false), layoutKey(path));
        assert.notEqual(layoutKey(path, true), layoutKey(path));
        assert.ok(layoutKey(path, true).startsWith("sozi-presenter-layout:"));
        assert.ok(layoutKey(path, true).includes(path));
        assert.notEqual(layoutKey("/a/x.html", true), layoutKey("/b/x.html", true));
    });

    test("a layout as a value passes the same check as saved text", () => {
        const layout = layoutOf(dock, rail);
        assert.deepEqual(layout, {version: 1, dock, rail});
        assert.deepEqual(readLayout(layout, knownIds), {dock, rail});
        assert.equal(readLayout({...layout, version: 2}, knownIds), null);
        assert.equal(readLayout({...layout, rail: null}, knownIds), null);
        assert.equal(readLayout(null, knownIds), null);
        assert.equal(readLayout(undefined, knownIds), null);
    });

    test("a saved layout comes first, at any width", () => {
        for (const narrow of [true, false]) {
            for (const preset of [true, false]) {
                assert.equal(layoutSource({narrow, saved: true, preset}), "saved");
            }
        }
    });

    test("a preset comes next, at any width", () => {
        assert.equal(layoutSource({narrow: true, saved: false, preset: true}), "preset");
        assert.equal(layoutSource({narrow: false, saved: false, preset: true}), "preset");
    });

    test("with neither, a narrow page stacks and a wide one has the default", () => {
        assert.equal(layoutSource({narrow: true, saved: false, preset: false}), "stack");
        assert.equal(layoutSource({narrow: false, saved: false, preset: false}), "default");
    });

    test("a page is narrow up to 600 pixels wide", () => {
        assert.equal(NARROW_MAX_WIDTH, 600);
        assert.equal(isNarrow(390), true);
        assert.equal(isNarrow(600), true);
        assert.equal(isNarrow(601), false);
        assert.equal(isNarrow(1280), false);
    });

    test("a panel in a window of its own is saved back in its group", () => {
        const grid = {
            root: {
                type: "branch",
                data: [
                    {
                        type: "leaf",
                        data: {views: ["current"], activeView: "current", id: "1"},
                        size: 500
                    },
                    {
                        type: "leaf",
                        data: {views: ["notes"], activeView: "notes", id: "2"},
                        size: 300
                    }
                ]
            }
        };
        const docked = {grid, panels: {current: {id: "current"}, notes: {id: "notes"}}};
        const window = {id: "next", group: "2", state: {id: "next", title: "Next"}};
        const saved = dockedLayout(docked, [window]);
        assert.deepEqual(saved.grid.root.data[1].data.views, ["notes", "next"]);
        assert.equal(saved.grid.root.data[1].data.activeView, "notes");
        assert.deepEqual(saved.panels.next, {id: "next", title: "Next"});
        // The dock it was given is left as it was.
        assert.deepEqual(docked.grid.root.data[1].data.views, ["notes"]);
        assert.equal(docked.panels.next, undefined);
    });

    test("a panel whose group is gone is saved in a group of its own on the right", () => {
        const grid = {
            root: {
                type: "branch",
                data: [
                    {
                        type: "leaf",
                        data: {views: ["current"], activeView: "current", id: "1"},
                        size: 800
                    }
                ]
            }
        };
        const docked = {grid, panels: {current: {id: "current"}}};
        const saved = dockedLayout(docked, [{id: "notes", group: "9", state: {id: "notes"}}]);
        const [, added] = saved.grid.root.data;
        assert.equal(added.type, "leaf");
        assert.deepEqual(added.data.views, ["notes"]);
        assert.equal(added.data.activeView, "notes");
        assert.notEqual(added.data.id, "1");
        assert.equal(added.size, 800);
        assert.deepEqual(readLayout(layoutOf(saved, []), ["current", "notes"])?.dock, saved);
    });

    test("with no panel in a window, the dock is saved as it is", () => {
        assert.deepEqual(dockedLayout(dock, []), dock);
    });
});
