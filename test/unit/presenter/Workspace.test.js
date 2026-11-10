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

/** What the workspace uses of dockview: panels in groups that can move, the active panel,
 * and a dock it can refuse.
 */
class FakeDock {
    /** Create an empty dock. */
    constructor() {
        this.panels = new Map();
        this.nextGroup = 0;
        this.loads = [];
        this.moves = [];
        this.layoutListener = () => {};
        this.activeListener = /** @type {(event: {panel: any}) => void} */ (() => {});
    }

    /**
     * A group of its own, for a panel.
     *
     * @returns {string} The new group's id.
     */
    newGroup() {
        return `group-${this.nextGroup++}`;
    }

    /**
     * Make a panel the active one, as a click on its tab does.
     *
     * @param {string} id - The panel's id.
     */
    activate(id) {
        this.activeListener({panel: this.panels.get(id)});
    }

    /**
     * How many panels are docked.
     *
     * @readonly
     * @type {number}
     */
    get totalPanels() {
        return this.panels.size;
    }

    /** Tell the listener of a change, in a microtask, as dockview does. */
    changed() {
        queueMicrotask(() => this.layoutListener());
    }

    /**
     * Put a panel in a group.
     *
     * @param {string} id - The panel's id.
     * @param {string} groupId - The group's id.
     */
    place(id, groupId) {
        const panel = {
            id,
            group: {id: groupId},
            api: {
                moveTo: ({group, position}) => {
                    this.moves.push({id, group: group.id, position});
                    const beside = position && position !== "center";
                    panel.group = beside ? {id: this.newGroup()} : group;
                    this.changed();
                }
            }
        };
        this.panels.set(id, panel);
    }

    /**
     * Add a panel: in the group it names, in its reference panel's group for `within`, or
     * in a new group.
     *
     * @param {object} options - The panel.
     * @param {string} options.id - Its id.
     * @param {{referenceGroup?: string, referencePanel?: string, direction?: string}} [options.position] -
     *   Where it goes.
     */
    addPanel({id, position}) {
        const within =
            position?.direction === "within" && this.panels.get(position.referencePanel ?? "");
        const groupId = position?.referenceGroup ?? (within ? within.group.id : this.newGroup());
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

    /**
     * Listen for the active panel changing.
     *
     * @param {(event: {panel: object}) => void} listener - The listener.
     * @returns {{dispose: Function}} What stops it.
     */
    onDidActivePanelChange(listener) {
        this.activeListener = listener;
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

    test("a panel added on the stack joins it", async () => {
        const {workspace, dock} = await openWorkspace();
        const added = addedPositions(dock);
        workspace.addPanel(latePanel());
        assert.deepEqual(added, [undefined]);
    });

    test("a closed panel leaves the dock, waits in the + menu and is saved so", async () => {
        const {workspace, dock, items} = await openWorkspace({width: 1280});
        const group = dock.getPanel("notes").group.id;
        workspace.close("notes");
        await settled();
        assert.equal(dock.getPanel("notes"), undefined);
        assert.deepEqual(workspace.layout.rail, [{id: "notes", group}]);
        assert.deepEqual(JSON.parse(items.get(KEYS.wide)).rail, [{id: "notes", group}]);
    });

    test("the last panel showing cannot be closed", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        workspace.close("current");
        assert.equal(workspace.menuState("notes").canClose, false);
        workspace.close("notes");
        assert.ok(dock.getPanel("notes"));
    });

    test("a panel added from the + menu goes right of the panel last used", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        workspace.close("notes");
        dock.activate("current");
        const added = addedPositions(dock);
        workspace.showPanel("notes");
        assert.deepEqual(added, [{referencePanel: "current", direction: "right"}]);
        assert.deepEqual(workspace.layout.rail, []);
    });

    test("on the stack, a panel can be closed and comes back as a tab of it", async () => {
        const {workspace, dock, items} = await openWorkspace();
        const stack = dock.getPanel("current").group.id;
        workspace.close("notes");
        assert.equal(dock.getPanel("notes"), undefined);
        assert.deepEqual(workspace.menuState("current").stacked, true);
        workspace.showPanel("notes");
        await settled();
        assert.equal(dock.getPanel("notes").group.id, stack);
        assert.equal(items.size, 0);
    });

    test("Replace with puts a closed panel in the group and closes the one it replaces", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        const group = dock.getPanel("current").group.id;
        workspace.close("notes");
        workspace.replace("current", "notes");
        assert.equal(dock.getPanel("notes").group.id, group);
        assert.equal(dock.getPanel("current"), undefined);
        assert.deepEqual(
            workspace.layout.rail.map(e => e.id),
            ["current"]
        );
    });

    test("Replace with moves a panel that is showing", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        const group = dock.getPanel("current").group.id;
        workspace.replace("current", "notes");
        assert.deepEqual(dock.moves, [{id: "notes", group, position: "center"}]);
        assert.equal(dock.getPanel("current"), undefined);
    });

    test("Split opens a closed panel beside, and moves a showing one there", async () => {
        const {workspace, dock} = await openWorkspace({width: 1280});
        const group = dock.getPanel("current").group.id;
        workspace.split("current", "notes", "below");
        assert.deepEqual(dock.moves, [{id: "notes", group, position: "bottom"}]);
        workspace.close("notes");
        const added = addedPositions(dock);
        workspace.split("current", "notes", "right");
        assert.deepEqual(added, [{referencePanel: "current", direction: "right"}]);
    });

    test("the panel menu offers every other panel, and Close while another shows", async () => {
        const {workspace} = await openWorkspace({width: 1280});
        const state = workspace.menuState("current");
        assert.deepEqual(
            state.others.map(p => p.id),
            ["notes"]
        );
        assert.equal(state.canClose, true);
        assert.equal(state.stacked, false);
        assert.equal(state.maximised, false);
    });

    test("choosing Default from the Layouts menu shows it and saves it", async () => {
        const {workspace, dock, items} = await openWorkspace({width: 1280});
        workspace.offerPresets({laptop: preset()});
        await settled();
        assert.deepEqual(groupsOf(dock), ["left", "right"]);
        assert.deepEqual(workspace.presetNames(), ["laptop", "Default"]);
        workspace.choosePreset("Default");
        await settled();
        assert.notDeepEqual(groupsOf(dock), ["left", "right"]);
        assert.ok(items.has(KEYS.wide));
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
