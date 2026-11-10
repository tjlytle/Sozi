import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {Workspace} from "../../../src/js/presenter/Workspace.js";

const IDS = ["current", "notes"];
const KEYS = {wide: "wide-key", narrow: "narrow-key"};

/**
 * An element with what the workspace and the rail use of one.
 *
 * @param {object} doc - The page it belongs to.
 * @returns {object} The element.
 */
function fakeElement(doc) {
    const classes = new Set();
    return {
        ownerDocument: doc,
        dataset: {},
        children: [],
        classes,
        classList: {
            toggle: (name, on) => (on ? classes.add(name) : classes.delete(name))
        },
        append() {},
        replaceChildren(...children) {
            this.children = children;
        },
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        remove() {}
    };
}

/** What the workspace uses of dockview: panels in groups, the one shown, and a dock it can
 * refuse.
 */
class FakeDock {
    /** Create an empty dock. */
    constructor() {
        this.panels = new Map();
        this.nextGroup = 0;
        this.loads = [];
        this.layoutListener = () => {};
    }

    /** Tell the listener of a change, in a microtask, as dockview does. */
    changed() {
        queueMicrotask(() => this.layoutListener());
    }

    /**
     * Put a panel in a group, as the active panel.
     *
     * @param {string} id - The panel's id.
     * @param {string} groupId - The group's id.
     */
    place(id, groupId) {
        const panel = {
            id,
            group: {id: groupId},
            api: {
                // As in dockview, the panel moved or added is the active one.
                moveTo: ({group}) => {
                    panel.group = group;
                    this.active = id;
                    this.changed();
                },
                setActive: () => {
                    this.active = id;
                }
            }
        };
        this.panels.set(id, panel);
        this.active = id;
    }

    /**
     * Add a panel, in a new group unless it names one.
     *
     * @param {object} options - The panel.
     * @param {string} options.id - Its id.
     * @param {{referenceGroup?: string}} [options.position] - Where it goes.
     */
    addPanel({id, position}) {
        const groupId = position?.referenceGroup ?? `group-${this.nextGroup++}`;
        this.place(id, groupId);
        this.changed();
    }

    /**
     * Find a panel.
     *
     * @param {string} id - Its id.
     * @returns {object|undefined} The panel.
     */
    getPanel(id) {
        return this.panels.get(id);
    }

    /**
     * Remove a panel.
     *
     * @param {object} panel - The panel.
     */
    removePanel(panel) {
        this.panels.delete(panel.id);
        this.changed();
    }

    /**
     * Find a group.
     *
     * @param {string} id - Its id.
     * @returns {object|undefined} The group of a panel in it.
     */
    getGroup(id) {
        return [...this.panels.values()].map(p => p.group).find(g => g.id === id);
    }

    /**
     * The dock as data.
     *
     * @returns {object} Each panel's group, by id.
     */
    toJSON() {
        const panels = {};
        for (const [id, {group}] of this.panels) {
            panels[id] = {group: group.id};
        }
        return {grid: {}, panels};
    }

    /**
     * Load a dock, or refuse one whose grid is marked so.
     *
     * @param {object} dock - The dock as data.
     */
    fromJSON(dock) {
        this.loads.push(dock);
        if (dock.grid.refused) {
            throw new Error("Refused");
        }
        this.panels.clear();
        for (const [id, {group}] of Object.entries(dock.panels)) {
            this.place(id, group);
        }
        this.changed();
    }

    /**
     * Is a group maximised?
     *
     * @returns {boolean} Never here.
     */
    hasMaximizedGroup() {
        return false;
    }

    /**
     * Listen for changes to the layout.
     *
     * @param {() => void} listener - The listener.
     * @returns {{dispose: Function}} What stops it.
     */
    onDidLayoutChange(listener) {
        this.layoutListener = listener;
        return {dispose() {}};
    }

    /**
     * Listen for a group being maximised, which never happens here.
     *
     * @returns {{dispose: Function}} What stops it.
     */
    onDidMaximizedGroupChange() {
        return {dispose() {}};
    }
}

/**
 * A preset for every width.
 *
 * @param {object} [grid] - Its grid.
 * @returns {object} The preset.
 */
function preset(grid = {}) {
    const dock = {grid, panels: {current: {group: "left"}, notes: {group: "right"}}};
    return {match: {minWidth: 0}, layout: {version: 1, dock, rail: []}};
}

const REFUSED = {refused: true};

/**
 * Open a workspace on a fake dock, a fake page and a fake storage.
 *
 * @param {object} [options] - The page.
 * @param {number} [options.width] - Its width.
 * @param {Record<string, string>} [options.stored] - What the storage holds.
 * @param {(workspace: Workspace) => void} [options.beforeOpen] - What happens before it opens.
 * @returns {Promise<object>} The workspace, its dock and what it said and saved.
 */
async function openWorkspace({width = 390, stored = {}, beforeOpen = () => {}} = {}) {
    const doc = {defaultView: {innerWidth: width}, createElement: () => fakeElement(doc)};
    const element = fakeElement(doc);
    const items = new Map(Object.entries(stored));
    const storage = /** @type {any} */ ({
        getItem: key => items.get(key) ?? null,
        setItem: (key, value) => items.set(key, value),
        removeItem: key => items.delete(key)
    });
    const media = /** @type {any} */ ({
        matches: width <= 600,
        addEventListener() {},
        removeEventListener() {}
    });
    const notices = [];
    const dock = new FakeDock();
    const workspace = new Workspace(element, {
        storage,
        keys: KEYS,
        media,
        onNotice: text => notices.push(text),
        onSavePreset() {},
        createDock: () => /** @type {any} */ (dock)
    });
    for (const id of IDS) {
        workspace.addPanel({id, title: id, icon: id, render: () => () => {}});
    }
    beforeOpen(workspace);
    workspace.open();
    // A hello is a later message, never in the same turn as the opening.
    await settled();
    return {workspace, element, dock, notices, items};
}

/**
 * Let what the dock queued tell its listener, and the workspace end its guard.
 *
 * @returns {Promise<void>} Resolved when the queue is empty.
 */
function settled() {
    return new Promise(resolve => setTimeout(resolve));
}

/**
 * The ids of the groups the panels are in.
 *
 * @param {FakeDock} dock - The dock.
 * @returns {string[]} One id per panel, in order.
 */
function groupsOf(dock) {
    return IDS.map(id => dock.getPanel(id).group.id);
}

const POSITION = {referencePanel: "current", direction: "right"};

/**
 * A panel that comes after the others, with a place in the default layout.
 *
 * @returns {object} The panel.
 */
function latePanel() {
    return {id: "late", title: "Late", icon: "L", position: POSITION, render: () => () => {}};
}

/**
 * Record where the dock is asked to add each panel from now on.
 *
 * @param {FakeDock} dock - The dock.
 * @returns {object[]} The positions, filled as they come.
 */
function addedPositions(dock) {
    const positions = [];
    const add = dock.addPanel.bind(dock);
    dock.addPanel = options => {
        positions.push(options.position);
        add(options);
    };
    return positions;
}

describe("Workspace", () => {
    test("a phone stays on the stack when dockview refuses its only preset", async () => {
        const {workspace, element, dock, notices, items} = await openWorkspace();
        workspace.offerPresets({phone: preset(REFUSED)});
        await settled();
        assert.equal(workspace.stacked, true);
        assert.ok(element.classes.has("sozi-workspace--stack"));
        assert.equal(new Set(groupsOf(dock)).size, 1);
        assert.deepEqual(notices, ["This page cannot use the deck's layout: phone."]);
        assert.equal(items.size, 0);
    });

    test("a laptop keeps the default dock when dockview refuses its only preset", async () => {
        const {workspace, element, dock, notices, items} = await openWorkspace({width: 1280});
        const built = dock.toJSON();
        workspace.offerPresets({laptop: preset(REFUSED)});
        await settled();
        assert.equal(workspace.stacked, false);
        assert.ok(!element.classes.has("sozi-workspace--stack"));
        assert.deepEqual(dock.toJSON(), built);
        assert.deepEqual(notices, ["This page cannot use the deck's layout: laptop."]);
        assert.equal(items.size, 0);
    });

    test("a refused preset falls through to the next one that matches", async () => {
        const {workspace, dock, notices, items} = await openWorkspace();
        workspace.offerPresets({bad: preset(REFUSED), good: preset()});
        await settled();
        assert.equal(workspace.stacked, false);
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.deepEqual(notices, ["This page cannot use the deck's layout: bad."]);
        assert.equal(items.size, 0);
    });

    test("a phone opens on a preset it can use, and saves nothing", async () => {
        const {workspace, dock, notices, items} = await openWorkspace();
        workspace.offerPresets({phone: preset()});
        await settled();
        assert.equal(workspace.stacked, false);
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.deepEqual(notices, []);
        assert.equal(items.size, 0);
    });

    test("a phone stays on the stack when the deck has no presets", async () => {
        const {workspace, dock, items} = await openWorkspace();
        const loads = dock.loads.length;
        workspace.offerPresets({});
        await settled();
        assert.equal(workspace.stacked, true);
        assert.equal(dock.loads.length, loads);
        assert.equal(items.size, 0);
    });

    test("a laptop's dock is not reloaded when the deck has no presets", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        workspace.offerPresets({});
        await settled();
        assert.deepEqual(dock.loads, []);
    });

    test("a saved layout wins over the first offer", async () => {
        const saved = preset().layout;
        const {workspace, dock, items} = await openWorkspace({
            stored: {[KEYS.narrow]: JSON.stringify(saved)}
        });
        const loads = dock.loads.length;
        workspace.offerPresets({phone: preset(REFUSED)});
        await settled();
        assert.equal(dock.loads.length, loads);
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.deepEqual(JSON.parse(items.get(KEYS.narrow)), saved);
    });

    test("only the first offer changes what is on the page", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        workspace.offerPresets({});
        await settled();
        workspace.offerPresets({laptop: preset()});
        await settled();
        assert.deepEqual(dock.loads, []);
    });

    test("a panel added after the opening saves nothing, so a later preset still arrives", async () => {
        const {workspace, items} = await openWorkspace();
        workspace.offerPresets({phone: preset()});
        await settled();
        workspace.addPanel(latePanel());
        await settled();
        assert.equal(items.size, 0);
    });

    test("two panels added in one turn save nothing", async () => {
        const {workspace, items} = await openWorkspace({width: 1280});
        workspace.addPanel(latePanel());
        workspace.addPanel({...latePanel(), id: "later"});
        await settled();
        assert.equal(items.size, 0);
    });

    test("a panel added on a phone's preset takes its default place", async () => {
        const {workspace, dock} = await openWorkspace();
        workspace.offerPresets({phone: preset()});
        await settled();
        const added = addedPositions(dock);
        workspace.addPanel(latePanel());
        assert.deepEqual(added, [POSITION]);
    });

    test("the stack opens on the panel that leads it", async () => {
        const {dock} = await openWorkspace();
        assert.equal(dock.active, IDS[0]);
    });

    test("a panel added on the stack joins it", async () => {
        const {workspace, dock} = await openWorkspace();
        const added = addedPositions(dock);
        workspace.addPanel(latePanel());
        assert.deepEqual(added, [undefined]);
    });

    test("presets offered before the opening are shown by it", async () => {
        const {workspace, dock} = await openWorkspace({
            beforeOpen: early => early.offerPresets({phone: preset()})
        });
        assert.equal(workspace.stacked, false);
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.equal(dock.loads.length, 1);
    });
});
