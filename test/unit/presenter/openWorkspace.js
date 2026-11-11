// A workspace opened on a fake dock, page and storage, and the presets and panels its unit
// tests hand it.

import {Workspace} from "../../../src/js/presenter/Workspace.js";
import {FakeDock} from "./FakeDock.js";
import {fakeElement, fakeWindow} from "./fakePage.js";

const IDS = ["current", "notes"];
const KEYS = {wide: "wide-key", narrow: "narrow-key"};

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
const REFUSED_LAYOUT = JSON.stringify(preset(REFUSED).layout);

/**
 * Open a workspace on a fake dock, a fake page and a fake storage.
 *
 * @param {object} [options] - The page.
 * @param {number} [options.width] - Its width.
 * @param {Record<string, string>} [options.stored] - What the storage holds.
 * @param {(workspace: Workspace) => void} [options.beforeOpen] - What happens before it opens.
 * @returns {Promise<object>} The workspace, its dock, the docks and windows of its panels'
 *   windows, and what it said and saved.
 */
async function openWorkspace({width = 390, stored = {}, beforeOpen = () => {}} = {}) {
    const windows = [];
    const view = {
        innerWidth: width,
        screenX: 0,
        screenY: 0,
        addEventListener() {},
        removeEventListener() {},
        open: () => {
            const opened = fakeWindow();
            windows.push(opened);
            return opened;
        }
    };
    const doc = {defaultView: view, styleSheets: [], createElement: () => fakeElement(doc)};
    Object.assign(view, {document: doc});
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
    // The first dock is the workspace's; the others are its windows'.
    const docks = [];
    const workspace = new Workspace(element, {
        storage,
        keys: KEYS,
        media,
        onNotice: text => notices.push(text),
        onSavePreset() {},
        createDock: () => {
            docks.push(docks.length ? new FakeDock() : dock);
            return /** @type {any} */ (docks.at(-1));
        }
    });
    for (const id of IDS) {
        workspace.addPanel({id, title: id, icon: id, render: () => () => {}});
    }
    beforeOpen(workspace);
    workspace.open();
    // A hello is a later message, never in the same turn as the opening.
    await settled();
    return {workspace, element, dock, docks, windows, notices, items};
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

export {IDS, KEYS, POSITION, REFUSED, REFUSED_LAYOUT};
export {preset, openWorkspace, settled, groupsOf, latePanel, addedPositions};
