import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {LayoutChooser} from "../../../src/js/presenter/LayoutChooser.js";

const IDS = ["current", "notes"];
const KEYS = {wide: "wide-key", narrow: "narrow-key"};

/**
 * A layout, in its stored form; a stage refuses it when its grid says so.
 *
 * @param {object} [grid] - Its grid.
 * @returns {object} The layout.
 */
function layout(grid = {}) {
    return {version: 1, dock: {grid, panels: {current: {}, notes: {}}}, rail: []};
}

const REFUSED = {refused: true};

/**
 * A preset for every width.
 *
 * @param {object} [grid] - The grid of its layout.
 * @returns {object} The preset.
 */
function preset(grid) {
    return {match: {minWidth: 0}, layout: layout(grid)};
}

/**
 * A stage that records what it is asked to show, in place of the workspace and its dock.
 *
 * @param {number} width - The page's width.
 * @returns {object} The stage; `shown` lists the grid of each layout it showed, "refused",
 *   "default" or "stack".
 */
function fakeStage(width) {
    return {
        width,
        stacked: false,
        maximised: false,
        /** @type {any[]} */
        shown: [],
        current: layout({current: true}),
        specs: () => IDS.map(id => ({id})),
        get layout() {
            return this.current;
        },
        showLayout(shown) {
            this.stacked = false;
            this.shown.push(shown.dock.grid.refused ? "refused" : shown.dock.grid);
            return !shown.dock.grid.refused;
        },
        showDefault() {
            this.stacked = false;
            this.shown.push("default");
        },
        showStack() {
            this.stacked = true;
            this.shown.push("stack");
        }
    };
}

/**
 * A narrow media query whose change can be fired.
 *
 * @param {boolean} matches - Is the page narrow?
 * @returns {object} The query; `listeners` holds its change listeners.
 */
function fakeMedia(matches) {
    const listeners = new Set();
    return {
        matches,
        listeners,
        addEventListener: (type, listener) => listeners.add(listener),
        removeEventListener: (type, listener) => listeners.delete(listener),
        fire(now) {
            for (const listener of listeners) {
                listener({matches: now});
            }
        }
    };
}

/**
 * A layout chooser on a fake stage, storage and media query, not yet open.
 *
 * @param {object} [options] - The page.
 * @param {number} [options.width] - Its width; up to 600 is narrow.
 * @param {Record<string, string>} [options.stored] - What the storage holds.
 * @returns {object} The chooser, its fakes, and what it said.
 */
function chooser({width = 1280, stored = {}} = {}) {
    const stage = fakeStage(width);
    const media = fakeMedia(width <= 600);
    const items = new Map(Object.entries(stored));
    const storage = {
        getItem: key => items.get(key) ?? null,
        setItem: (key, value) => items.set(key, value),
        removeItem: key => items.delete(key)
    };
    const notices = [];
    const layouts = new LayoutChooser(/** @type {any} */ (stage), {
        storage: /** @type {any} */ (storage),
        keys: KEYS,
        media: /** @type {any} */ (media),
        onNotice: text => notices.push(text)
    });
    return {layouts, stage, media, items, notices};
}

/**
 * Let the chooser end its guard.
 *
 * @returns {Promise<void>} Resolved when the queue is empty.
 */
function settled() {
    return new Promise(resolve => setTimeout(resolve));
}

describe("LayoutChooser", () => {
    test("the page opens on the layout saved for its width, before any preset", () => {
        const saved = layout({saved: true});
        const {layouts, stage} = chooser({stored: {[KEYS.wide]: JSON.stringify(saved)}});
        layouts.offerPresets({laptop: preset()});
        layouts.open();
        assert.deepEqual(stage.shown, [saved.dock.grid]);
    });

    test("with nothing saved, the page opens on the deck's preset", () => {
        const {layouts, stage} = chooser({width: 390});
        layouts.offerPresets({phone: preset({phone: true})});
        layouts.open();
        assert.deepEqual(stage.shown, [{phone: true}]);
    });

    test("with nothing saved and no preset, a narrow page shows the stack", () => {
        const {layouts, stage} = chooser({width: 390});
        layouts.open();
        assert.deepEqual(stage.shown, ["stack"]);
    });

    test("with nothing saved and no preset, a wide page keeps the dock it was built with", () => {
        const {layouts, stage} = chooser();
        layouts.open();
        assert.deepEqual(stage.shown, []);
    });

    test("nothing is shown before the page opens", () => {
        const {layouts, stage} = chooser();
        layouts.offerPresets({laptop: preset()});
        assert.deepEqual(stage.shown, []);
    });

    test("only the first offer arranges the page", () => {
        const {layouts, stage} = chooser();
        layouts.open();
        layouts.offerPresets({});
        layouts.offerPresets({laptop: preset()});
        assert.deepEqual(stage.shown, []);
        assert.deepEqual(layouts.presetNames(), ["laptop", "Default"]);
    });

    test("the first offer does not replace a saved layout the page shows", () => {
        const saved = layout({saved: true});
        const {layouts, stage} = chooser({stored: {[KEYS.wide]: JSON.stringify(saved)}});
        layouts.open();
        layouts.offerPresets({laptop: preset()});
        assert.deepEqual(stage.shown, [saved.dock.grid]);
    });

    test("a saved layout the stage refuses gives way to the first offer", () => {
        const stored = {[KEYS.wide]: JSON.stringify(layout(REFUSED))};
        const {layouts, stage} = chooser({stored});
        layouts.open();
        layouts.offerPresets({laptop: preset()});
        assert.deepEqual(stage.shown, ["refused", "refused", {}]);
    });

    test("a refused preset falls through to the next one, with a notice", () => {
        const {layouts, stage, notices} = chooser();
        layouts.open();
        layouts.offerPresets({bad: preset(REFUSED), good: preset({good: true})});
        assert.deepEqual(stage.shown, ["refused", {good: true}]);
        assert.deepEqual(notices, ["This page cannot use the deck's layout: bad."]);
    });

    test("a refused preset on a wide page leaves the dock it was built with", () => {
        const {layouts, stage, notices} = chooser();
        layouts.offerPresets({bad: preset(REFUSED)});
        layouts.open();
        assert.deepEqual(stage.shown, ["refused"]);
        assert.deepEqual(notices, ["This page cannot use the deck's layout: bad."]);
    });

    test("save writes the stage's layout for the page's width once it is open", async () => {
        const {layouts, stage, items} = chooser();
        layouts.save();
        assert.equal(items.size, 0);
        layouts.open();
        await settled();
        layouts.save();
        assert.deepEqual(JSON.parse(items.get(KEYS.wide)), stage.current);
        assert.equal(items.size, 1);
    });

    test("save writes nothing while the chooser arranges the page", async () => {
        const {layouts, items} = chooser();
        layouts.open();
        layouts.save();
        layouts.whileArranging(() => layouts.save());
        assert.equal(items.size, 0);
        await settled();
        layouts.save();
        assert.equal(items.size, 1);
    });

    test("the guard ends when the change throws", async () => {
        const {layouts, items} = chooser();
        layouts.open();
        const refused = new Error("refused");
        assert.throws(
            () =>
                layouts.whileArranging(() => {
                    throw refused;
                }),
            error => error === refused
        );
        await settled();
        layouts.save();
        assert.equal(items.size, 1);
    });

    test("save writes nothing on the stack or while a panel is maximised", async () => {
        const {layouts, stage, items} = chooser();
        layouts.open();
        await settled();
        stage.stacked = true;
        layouts.save();
        stage.stacked = false;
        stage.maximised = true;
        layouts.save();
        assert.equal(items.size, 0);
    });

    test("choosing from the Layouts menu shows the layout and saves it", async () => {
        const {layouts, stage, items, notices} = chooser();
        layouts.open();
        layouts.offerPresets({laptop: preset({laptop: true}), bad: preset(REFUSED)});
        await settled();
        layouts.choosePreset("Default");
        assert.deepEqual(stage.shown.at(-1), "default");
        assert.ok(items.has(KEYS.wide));
        layouts.choosePreset("bad");
        assert.deepEqual(notices.at(-1), "This page cannot use the deck's layout: bad.");
    });

    test("reset clears only the current width's slot and arranges the page again", async () => {
        const saved = JSON.stringify(layout({saved: true}));
        const stored = {[KEYS.wide]: saved, [KEYS.narrow]: saved};
        const {layouts, stage, items} = chooser({stored});
        layouts.open();
        await settled();
        layouts.reset();
        assert.equal(items.has(KEYS.wide), false);
        assert.equal(items.get(KEYS.narrow), saved);
        assert.deepEqual(stage.shown.at(-1), "default");
    });

    test("crossing the narrow width switches the slot and arranges the page", async () => {
        const narrowSaved = layout({narrow: true});
        const stored = {[KEYS.narrow]: JSON.stringify(narrowSaved)};
        const {layouts, stage, media, items} = chooser({stored});
        media.fire(true);
        assert.deepEqual(stage.shown, []);
        layouts.open();
        media.fire(true);
        assert.deepEqual(stage.shown, [narrowSaved.dock.grid]);
        await settled();
        layouts.save();
        assert.deepEqual(JSON.parse(items.get(KEYS.narrow)), stage.current);
        assert.equal(items.has(KEYS.wide), false);
    });

    test("dispose stops listening to the media query", () => {
        const {layouts, media} = chooser();
        assert.equal(media.listeners.size, 1);
        layouts.dispose();
        assert.equal(media.listeners.size, 0);
    });
});
