/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

// The UMD build is the one that brings dockview's styles with it.
import {createDockview, themeLight} from "dockview-core/dist/dockview-core.js";
import {PanelMenu} from "./PanelMenu.js";
import {PanelWindow} from "./PanelWindow.js";
import {WorkspaceBar} from "./WorkspaceBar.js";
import {closedItems, panelChoices, presetChoices} from "./arrangement.js";
import {dockedLayout, layoutOf, layoutSource, readSavedLayout, savedLayoutText} from "./layout.js";
import {pickPreset} from "./presets.js";

/** @typedef {import("../protocol/layoutPresets.js").LayoutPreset} LayoutPreset */
/** @typedef {import("./layout.js").ClosedEntry} ClosedEntry */
/** @typedef {import("./layout.js").SavedLayout} SavedLayout */
/** @typedef {import("./layout.js").WindowEntry} WindowEntry */
/** @typedef {import("./PanelMenu.js").PanelMenuState} PanelMenuState */

/**
 * A panel of the workspace.
 *
 * @typedef {object} PanelSpec
 * @property {string} id - Its id, which the saved layout names.
 * @property {string} title - The title of its tab and of its item in the menus.
 * @property {string} icon - The glyph before its title in the menus.
 * @property {string} [description] - One line under its title in the + menu.
 * @property {(element: HTMLElement) => () => void} render - Draws the panel into an
 *   element, once; returns the function that cleans it up.
 * @property {object} [position] - Where it goes in the default layout, as dockview's
 *   `addPanel` takes it (`referencePanel` and `direction`); the first panel has none.
 * @property {boolean} [inactive] - Is it a tab behind another one in the default layout?
 * @property {number} [initialHeight] - Its height in the default layout, in pixels.
 */

/**
 * What a workspace is built with.
 *
 * @typedef {object} WorkspaceOptions
 * @property {Storage} storage - Where the layouts are saved.
 * @property {{wide: string, narrow: string}} keys - The key of each width's layout in the
 *   storage.
 * @property {MediaQueryList} media - Matches while the page is narrow.
 * @property {(text: string) => void} onNotice - Says something to the speaker.
 * @property {() => void} onSavePreset - Called when Save as preset is pressed.
 * @property {typeof createDockview} [createDock] - What builds the dock; dockview unless a
 *   test passes a fake, as dockview needs a real page.
 */

/**
 * Where a panel that comes back goes: beside a panel, or wherever the workspace puts it.
 *
 * @typedef {object} PanelPlace
 * @property {string} [referenceId] - The panel it goes beside, or in the group of.
 * @property {"right" | "below" | "within"} [direction] - Where, from that panel.
 */

/**
 * The options dockview adds a panel with, but its position.
 *
 * @param {PanelSpec} spec - The panel.
 * @returns {{id: string, title: string, component: string, renderer: "always"}} The options.
 */
function panelOptions({id, title}) {
    return {id, title, component: id, renderer: "always"};
}

/**
 * Dock a panel at its default place, or in the active group when that cannot be: the stack
 * is the only place while it shows, and its reference panel may be closed.
 *
 * @param {any} dock - The dockview dock.
 * @param {PanelSpec} spec - The panel.
 * @param {boolean} stacked - Is the page showing one stack of tabs?
 */
function dockPanel(dock, spec, stacked) {
    const {position, inactive} = spec;
    const reference = position && position.referencePanel;
    const placeable = !stacked && (!reference || dock.getPanel(reference));
    dock.addPanel({...panelOptions(spec), position: placeable ? position : undefined, inactive});
}

/** The presenter's workspace: panels docked in dockview, a bar of menus, and a narrow stack.
 *
 * Every panel is drawn once into an element of its own, and dockview renders it with
 * `renderer: "always"`, so a preview's iframe is never moved and never reloads when its
 * panel is dragged. A change the speaker makes, by dragging or from a menu, is saved for the
 * page's width, except while the page shows the stack or a panel is maximised. Showing a
 * preset by itself saves nothing, so a preset the deck changes later still reaches this
 * device; choosing one from the Layouts menu saves it.
 */
export class Workspace {
    /** Build an empty workspace in an element.
     *
     * @param {HTMLElement} element - The element the bar and the dock go in.
     * @param {WorkspaceOptions} options - Where the layouts are saved, the narrow query, and
     *   what the workspace tells its owner.
     */
    constructor(
        element,
        {storage, keys, media, onNotice, onSavePreset, createDock = createDockview}
    ) {
        this.element = element;
        this.storage = storage;
        this.keys = keys;
        this.media = media;
        this.onNotice = onNotice;
        this.createDock = createDock;

        /** Each panel's spec, its element and its cleanup, by id, in the order added.
         *
         * @type {Map<string, {spec: PanelSpec, content: HTMLElement, cleanup: () => void}>}
         */
        this.panels = new Map();

        /** The closed panels, in the order they were closed.
         *
         * @type {ClosedEntry[]}
         */
        this.closed = [];

        /** The groups in windows of their own, by the id of the dock group they left: their
         * panels in tab order, and the window.
         *
         * @type {Map<string, {entries: WindowEntry[], window: PanelWindow}>}
         */
        this.windows = new Map();

        /** The panel the speaker used last, which + opens a panel beside.
         *
         * @type {?string}
         */
        this.lastUsed = null;

        /** Has `open` run? Nothing is saved or arranged before it.
         *
         * @type {boolean}
         */
        this.opened = false;

        /** The deck's layout presets, the latest the display reported.
         *
         * @type {Record<string, LayoutPreset>}
         */
        this.presets = {};

        /** Has a preset been offered yet? Only the first offer changes what is on the page.
         *
         * @type {boolean}
         */
        this.offered = false;

        /** How many of the workspace's own changes to the dock are still being told; what
         * they fire is not the speaker's.
         *
         * @type {number}
         */
        this.arranging = 0;

        /** The default dock, as built from the panels' positions.
         *
         * @type {any}
         */
        this.defaultDock = null;

        /** Is the page narrow? It picks the layout's slot in the storage.
         *
         * @type {boolean}
         */
        this.narrow = false;

        /** Is the page showing one stack of tabs? Nothing is saved while it is.
         *
         * @type {boolean}
         */
        this.stacked = false;

        const doc = element.ownerDocument;
        this.bar = new WorkspaceBar(doc, {
            closed: () => closedItems(this.specs(), this.shownIds()),
            presets: () => this.presetNames(),
            onAdd: id => this.showPanel(id),
            onPreset: name => this.choosePreset(name),
            onReset: () => this.reset(),
            onSavePreset: () => {
                // A maximised dock is one panel for now, not a layout to hand on.
                if (this.dock.hasMaximizedGroup()) {
                    this.dock.exitMaximizedGroup();
                }
                onSavePreset();
            }
        });
        const root = doc.createElement("div");
        root.className = "sozi-dock";
        element.append(this.bar.element, root);

        this.dock = createDock(root, {
            ...this.dockOptions(doc),
            createRightHeaderActionComponent: group => {
                const menu = new PanelMenu(group, {
                    state: id => this.menuState(id),
                    onReplace: (id, withId) => this.replace(id, withId),
                    onSplit: (id, withId, direction) => this.split(id, withId, direction),
                    onMaximise: id => this.maximise(id),
                    onPopOut: id => this.popOut(id),
                    onClose: id => this.close(id)
                });
                return {element: menu.element, init() {}, dispose: () => menu.dispose()};
            }
        });
        this.subscriptions = [
            this.dock.onDidLayoutChange(() => this.save()),
            this.dock.onDidActivePanelChange(({panel}) => {
                if (panel) {
                    this.lastUsed = panel.id;
                }
            })
        ];
        this.onMediaChange = evt => this.setNarrow(evt.matches);
        media.addEventListener("change", this.onMediaChange);
    }

    /** The options of a dock that shows the workspace's panels: the main one, or a window's.
     *
     * @param {Document} doc - The page.
     * @returns {object} The options, as dockview takes them.
     */
    dockOptions(doc) {
        return {
            theme: themeLight,
            defaultRenderer: "always",
            // Pointer events, not HTML5 drag and drop: a tab dragged over an iframe still docks.
            dndStrategy: "pointer",
            disableFloatingGroups: true,
            // A tab is its title only: the ⋯ menu closes a panel.
            defaultTabComponent: "title",
            createTabComponent: () => {
                const title = doc.createElement("span");
                title.className = "sozi-tab";
                return {element: title, init: params => (title.textContent = params.title)};
            },
            // A frame around the panel's own element, which is drawn once and only moved.
            createComponent: ({name}) => {
                const frame = doc.createElement("div");
                frame.className = "sozi-panel-frame";
                frame.append(/** @type {{content: HTMLElement}} */ (this.panels.get(name)).content);
                return {element: frame, init() {}};
            }
        };
    }

    /** Add a panel at its place in the default layout and draw it; that saves nothing.
     *
     * @param {PanelSpec} spec - The panel.
     */
    addPanel(spec) {
        const content = this.element.ownerDocument.createElement("div");
        content.className = "sozi-panel";
        const cleanup = spec.render(content);
        this.panels.set(spec.id, {spec, content, cleanup});
        this.whileArranging(() => dockPanel(this.dock, spec, this.stacked));
    }

    /** Size the default layout, remember it, show what this width shows, and start saving. */
    open() {
        // A group's height is set once every panel is in: a later split would halve it.
        for (const {spec} of this.panels.values()) {
            const panel = this.dock.getPanel(spec.id);
            if (panel && spec.initialHeight) {
                panel.group.api.setSize({height: spec.initialHeight});
            }
        }
        this.defaultDock = this.dock.toJSON();
        this.opened = true;
        this.narrow = this.media.matches;
        this.arrange(true);
    }

    /** Take the deck's presets; the first offer shows one, unless a layout is saved here.
     *
     * The display can answer many times, and a talk must not rearrange itself when it does:
     * later presets wait for a reset, a move across the narrow width, or the Layouts menu.
     * Presets that come before `open` wait for it, as it shows them.
     *
     * @param {Record<string, LayoutPreset>} presets - The presets, in the deck's order.
     */
    offerPresets(presets) {
        this.presets = presets;
        if (!this.offered) {
            this.offered = true;
            // With nothing saved, the dock is still the default, or the stack on a narrow page.
            if (this.opened && !this.savedLayout()) {
                this.arrange(true);
            }
        }
    }

    /** The current layout, in its stored form; a panel in a window of its own is docked.
     *
     * @readonly
     * @type {import("../protocol/layoutPresets.js").PresetLayout}
     */
    get layout() {
        const windows = [...this.windows.values()].flatMap(w => w.entries);
        return layoutOf(
            dockedLayout(this.dock.toJSON(), windows),
            this.closed.map(e => ({...e}))
        );
    }

    /** Is a panel in a window of its own?
     *
     * @param {string} id - The panel's id.
     * @returns {boolean} True if it is.
     */
    inWindow(id) {
        return [...this.windows.values()].some(w => w.entries.some(e => e.id === id));
    }

    /** Every panel's spec, in the order added.
     *
     * @returns {PanelSpec[]} The specs.
     */
    specs() {
        return [...this.panels.values()].map(p => p.spec);
    }

    /** The panels that are showing: docked, or in a window of their own.
     *
     * @returns {string[]} Their ids.
     */
    shownIds() {
        return [...this.panels.keys()].filter(id => this.dock.getPanel(id) || this.inWindow(id));
    }

    /** What a panel's ⋯ menu offers now.
     *
     * @param {string} id - The panel's id.
     * @returns {PanelMenuState} The state.
     */
    menuState(id) {
        const canClose = this.dock.totalPanels > 1;
        const docked = this.specs().filter(spec => !this.inWindow(spec.id));
        const panel = this.dock.getPanel(id);
        // A group pops out whole, and the dock keeps a panel.
        const leaves = panel ? panel.group.panels.length : 0;
        return {
            stacked: this.stacked,
            canClose,
            canPopOut: !this.stacked && this.dock.totalPanels > leaves,
            maximised: this.dock.hasMaximizedGroup(),
            others: panelChoices(docked, id)
        };
    }

    /** Close a panel; the + menu lists it. The last panel docked stays.
     *
     * @param {string} id - The panel's id.
     */
    close(id) {
        const panel = this.dock.getPanel(id);
        if (!panel || this.dock.totalPanels <= 1) {
            return;
        }
        if (this.dock.hasMaximizedGroup()) {
            this.dock.exitMaximizedGroup();
        }
        this.closed.push({id, group: panel.group.id});
        this.dock.removePanel(panel);
        this.save();
    }

    /** Show a closed panel: beside a panel, as a tab of the stack, or right of the panel used
     * last.
     *
     * @param {string} id - The panel's id.
     * @param {PanelPlace} [place] - Where it goes.
     */
    showPanel(id, {referenceId, direction = "right"} = {}) {
        const entry = this.panels.get(id);
        if (!entry || this.dock.getPanel(id) || this.inWindow(id)) {
            return;
        }
        if (this.dock.hasMaximizedGroup()) {
            this.dock.exitMaximizedGroup();
        }
        this.closed = this.closed.filter(e => e.id !== id);
        this.dock.addPanel({
            ...panelOptions(entry.spec),
            position: this.placeOf(referenceId, direction)
        });
        this.save();
    }

    /** Where `addPanel` puts a panel that comes back.
     *
     * @param {string | undefined} referenceId - The panel it goes beside, if one is named.
     * @param {"right" | "below" | "within"} direction - Where, from that panel.
     * @returns {object} The position, as dockview takes it.
     */
    placeOf(referenceId, direction) {
        if (this.stacked) {
            const lead = this.specs()
                .map(spec => this.dock.getPanel(spec.id))
                .find(Boolean);
            return lead ? {referenceGroup: lead.group.id} : undefined;
        }
        const reference = [referenceId, this.lastUsed].find(r => r && this.dock.getPanel(r));
        return reference
            ? {
                  referencePanel: reference,
                  direction: reference === referenceId ? direction : "right"
              }
            : {direction: "right"};
    }

    /** Put a panel in another's place: a closed one opens there, a docked one moves there.
     * The panel it replaces is closed.
     *
     * @param {string} id - The panel to replace.
     * @param {string} withId - The panel that takes its place.
     */
    replace(id, withId) {
        const panel = this.dock.getPanel(id);
        if (!panel || id === withId) {
            return;
        }
        const other = this.dock.getPanel(withId);
        if (other) {
            other.api.moveTo({group: panel.group, position: "center"});
        } else {
            this.showPanel(withId, {referenceId: id, direction: "within"});
        }
        this.close(id);
    }

    /** Put a panel beside another: a closed one opens there, a docked one moves there.
     *
     * @param {string} id - The panel it goes beside.
     * @param {string} withId - The panel that goes there.
     * @param {"right" | "below"} direction - Which side.
     */
    split(id, withId, direction) {
        const panel = this.dock.getPanel(id);
        if (!panel || id === withId) {
            return;
        }
        const other = this.dock.getPanel(withId);
        if (other) {
            other.api.moveTo({
                group: panel.group,
                position: direction === "below" ? "bottom" : "right"
            });
            this.save();
        } else {
            this.showPanel(withId, {referenceId: id, direction});
        }
    }

    /** Fill the workspace with a panel's group, or bring back the layout if one does.
     *
     * @param {string} id - The panel's id.
     */
    maximise(id) {
        const panel = this.dock.getPanel(id);
        if (this.dock.hasMaximizedGroup()) {
            this.dock.exitMaximizedGroup();
        } else if (panel) {
            this.dock.maximizeGroup(panel);
        }
    }

    /** Move a panel's group, every tab of it, to a window of its own; closing the window docks
     * it again.
     *
     * @param {string} id - The panel's id.
     */
    popOut(id) {
        const panel = this.dock.getPanel(id);
        if (!panel || !this.menuState(id).canPopOut) {
            return;
        }
        if (this.dock.hasMaximizedGroup()) {
            this.dock.exitMaximizedGroup();
        }
        const {group} = panel;
        /** @type {any[]} */
        const tabs = [...group.panels];
        const entries = tabs.map(tab => ({
            id: tab.id,
            group: group.id,
            state: tab.toJSON(),
            active: tab === group.activePanel
        }));
        const title = /** @type {{spec: PanelSpec}} */ (this.panels.get(id)).spec.title;
        const view = /** @type {Window} */ (this.element.ownerDocument.defaultView);
        const window = new PanelWindow(view, {
            id: group.id,
            title,
            box: group.element.getBoundingClientRect(),
            buildDock: root => {
                // A panel's content can be in one place only: it leaves this dock first.
                for (const tab of tabs) {
                    this.dock.removePanel(tab);
                }
                const dock = this.createDock(root, this.dockOptions(root.ownerDocument));
                this.dockEntries(dock, entries, undefined);
                return dock;
            },
            onClose: () => this.dockBack(group.id)
        });
        if (!window.open()) {
            this.onNotice(
                `The browser blocked the window for "${title}": allow pop-ups for this page.`
            );
            return;
        }
        this.windows.set(group.id, {entries, window});
        this.save();
    }

    /** Dock a group's panels as one group, in tab order, showing the tab it showed.
     *
     * @param {any} dock - The dock they go in.
     * @param {WindowEntry[]} entries - The panels.
     * @param {object | undefined} position - Where the group goes, as dockview takes it.
     */
    dockEntries(dock, entries, position) {
        let place = position;
        for (const {id, active} of entries) {
            const {spec} = /** @type {{spec: PanelSpec}} */ (this.panels.get(id));
            dock.addPanel({...panelOptions(spec), position: place, inactive: !active});
            place = {referenceGroup: dock.getPanel(id).group.id};
        }
    }

    /** Dock a group whose window closed, in the group it left or right of the dock.
     *
     * @param {string} key - The id of the dock group it left.
     */
    dockBack(key) {
        const popped = this.windows.get(key);
        if (!popped) {
            return;
        }
        this.windows.delete(key);
        const group = this.dock.getGroup(key);
        const position = group ? {referenceGroup: group.id} : this.placeOf(undefined, "right");
        this.dockEntries(this.dock, popped.entries, position);
        this.save();
    }

    /** Close every panel's window, and leave their panels out of the dock. */
    closeWindows() {
        for (const {window} of this.windows.values()) {
            window.dispose();
        }
        this.windows.clear();
    }

    /** The names of the layouts the Layouts menu offers.
     *
     * @returns {string[]} The deck's presets for this width, then Default.
     */
    presetNames() {
        return presetChoices(this.presets, this.width, [...this.panels.keys()]).map(c => c.name);
    }

    /** Show a layout from the Layouts menu, and save it for this width.
     *
     * @param {string} name - A preset's name, or Default.
     */
    choosePreset(name) {
        const choice = presetChoices(this.presets, this.width, [...this.panels.keys()]).find(
            c => c.name === name
        );
        if (!choice) {
            return;
        }
        if (choice.layout && !this.showLayout(choice.layout)) {
            this.onNotice(`This page cannot use the deck's layout: ${name}.`);
        } else if (!choice.layout) {
            this.showLayout({dock: this.defaultDock, rail: []});
        }
        this.save();
    }

    /** Forget the layout saved for this width, and go back to the preset or the default. */
    reset() {
        this.storage.removeItem(this.slot);
        this.arrange();
    }

    /** The page's width, in CSS pixels.
     *
     * @readonly
     * @type {number}
     */
    get width() {
        // Cast: the workspace's page is showing, so it has a window.
        return /** @type {Window} */ (this.element.ownerDocument.defaultView).innerWidth;
    }

    /** The key of the layout saved for the page's width.
     *
     * @readonly
     * @type {string}
     */
    get slot() {
        return this.narrow ? this.keys.narrow : this.keys.wide;
    }

    /** The layout saved for the page's width, if it can be used.
     *
     * @returns {?SavedLayout} The layout.
     */
    savedLayout() {
        const text = this.storage.getItem(this.slot);
        return text === null ? null : readSavedLayout(text, [...this.panels.keys()]);
    }

    /** Change the dock without what that fires counting as the speaker's change.
     *
     * Dockview tells its listeners in a microtask queued by the first change, so this one,
     * queued after them all, ends the guard once they have been told. Changes in one turn
     * overlap, so the guard lasts until the last of them ends.
     *
     * @param {() => void} change - What changes the dock.
     */
    whileArranging(change) {
        this.arranging++;
        change();
        queueMicrotask(() => this.arranging--);
    }

    /** Show what the page's width shows, by the precedence of `layoutSource`.
     *
     * @param {boolean} [atDefault] - Is the dock still as the panels built it?
     */
    arrange(atDefault = false) {
        this.whileArranging(() => {
            const saved = this.savedLayout();
            const savedShown = saved !== null && this.showLayout(saved);
            const presetShown = !savedShown && this.showPreset();
            const source = layoutSource({
                narrow: this.narrow,
                saved: savedShown,
                preset: presetShown
            });
            if (source === "stack") {
                this.showStack();
            } else if (source === "default" && !atDefault) {
                this.showLayout({dock: this.defaultDock, rail: []});
            }
        });
    }

    /** Show the first preset of the deck this page can use, and name those it cannot.
     *
     * @returns {boolean} True if a preset is shown.
     */
    showPreset() {
        const ids = [...this.panels.keys()];
        /** @type {string[]} */
        const failed = [];
        let pick = pickPreset(this.presets, this.width, ids);
        const {refused} = pick;
        while (pick.layout && !this.showLayout(pick.layout)) {
            failed.push(/** @type {string} */ (pick.name));
            pick = pickPreset(this.presets, this.width, ids, failed);
        }
        const unusable = [...new Set([...refused, ...pick.refused, ...failed])];
        if (unusable.length) {
            this.onNotice(`This page cannot use the deck's layout: ${unusable.join(", ")}.`);
        }
        return pick.layout !== null;
    }

    /** Show a layout: its dock, and its closed panels in the + menu.
     *
     * A panel it does not name goes to its default place; a panel in a window comes back.
     *
     * @param {SavedLayout} layout - The layout.
     * @returns {boolean} False if dockview refused its dock, which leaves the default one.
     */
    showLayout(layout) {
        this.closeWindows();
        if (this.dock.hasMaximizedGroup()) {
            this.dock.exitMaximizedGroup();
        }
        this.setStacked(false);
        let shown = true;
        this.closed = layout.rail.map(entry => ({...entry}));
        try {
            this.dock.fromJSON(layout.dock, {reuseExistingPanels: true});
        } catch {
            // A dock that dockview cannot read is a layout that cannot be used.
            shown = false;
            this.closed = [];
            this.dock.fromJSON(this.defaultDock, {reuseExistingPanels: true});
        }
        for (const {id} of this.closed) {
            const panel = this.dock.getPanel(id);
            if (panel) {
                this.dock.removePanel(panel);
            }
        }
        // A panel registered after this layout was made is not in it, and dockview dropped it.
        for (const {spec} of this.panels.values()) {
            if (!this.dock.getPanel(spec.id) && !this.closed.some(e => e.id === spec.id)) {
                dockPanel(this.dock, spec, this.stacked);
            }
        }
        return shown;
    }

    /** Save the layout for the page's width, unless the speaker did not change it. */
    save() {
        const noChange = !this.opened || this.arranging > 0 || this.stacked;
        if (noChange || this.dock.hasMaximizedGroup()) {
            return;
        }
        const {dock, rail} = this.layout;
        this.storage.setItem(this.slot, savedLayoutText(dock, rail));
    }

    /** Take the page's width class, and show what that width shows.
     *
     * @param {boolean} narrow - Is the page narrow now?
     */
    setNarrow(narrow) {
        if (narrow === this.narrow || !this.opened) {
            return;
        }
        this.narrow = narrow;
        this.arrange();
    }

    /** Say whether the page shows the stack, whose panel menus offer Close only.
     *
     * @param {boolean} stacked - Does it?
     */
    setStacked(stacked) {
        this.stacked = stacked;
        this.element.classList.toggle("sozi-workspace--stack", stacked);
    }

    /** Show every panel as one stack of tabs.
     *
     * The first panel added leads the stack; closed panels are tabs of it too.
     */
    showStack() {
        this.closeWindows();
        if (this.dock.hasMaximizedGroup()) {
            this.dock.exitMaximizedGroup();
        }
        // Set first, so that the moves below are not saved.
        this.setStacked(true);
        this.closed = [];
        const specs = this.specs();
        const lead = specs.map(spec => this.dock.getPanel(spec.id)).find(Boolean);
        const target = /** @type {any} */ (lead).group;
        for (const spec of specs) {
            const panel = this.dock.getPanel(spec.id);
            if (!panel) {
                this.dock.addPanel({...panelOptions(spec), position: {referenceGroup: target.id}});
            } else if (panel.group !== target) {
                panel.api.moveTo({group: target});
            }
        }
    }

    /** Remove the dock, the bar, the panels' windows and every panel, and stop listening. */
    dispose() {
        this.media.removeEventListener("change", this.onMediaChange);
        for (const s of this.subscriptions) {
            s.dispose();
        }
        this.closeWindows();
        this.dock.dispose();
        this.bar.dispose();
        for (const {cleanup} of this.panels.values()) {
            cleanup();
        }
        this.panels.clear();
    }
}
