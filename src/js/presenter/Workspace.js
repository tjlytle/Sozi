/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

// The UMD build is the one that brings dockview's styles with it.
import {createDockview, themeLight} from "dockview-core/dist/dockview-core.js";
import {Rail} from "./Rail.js";
import {layoutOf, layoutSource, readSavedLayout, savedLayoutText} from "./layout.js";
import {pickPreset} from "./presets.js";

/** @typedef {import("../protocol/layoutPresets.js").LayoutPreset} LayoutPreset */
/** @typedef {import("./layout.js").RailEntry} RailEntry */
/** @typedef {import("./layout.js").SavedLayout} SavedLayout */

/**
 * A panel of the workspace.
 *
 * @typedef {object} PanelSpec
 * @property {string} id - Its id, which the saved layout names.
 * @property {string} title - The title of its tab and of its button on the rail.
 * @property {string} icon - The text of its button on the rail.
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
 * The Minimise and Maximise buttons of a group header, as dockview takes them.
 *
 * Each acts on the group's active panel.
 *
 * @param {any} group - The dockview group.
 * @param {(id: string) => void} onMinimise - Minimises a panel.
 * @param {(id: string) => void} onMaximise - Maximises a panel, or restores the layout.
 * @returns {{element: HTMLElement, maximise: HTMLButtonElement}} The buttons' element, and
 *   the maximise button, which is labelled for what it does now.
 */
function groupActions(group, onMinimise, onMaximise) {
    const doc = group.element.ownerDocument;
    const element = doc.createElement("div");
    element.className = "sozi-group-actions";
    const button = (text, label, act) => {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = "sozi-group-actions__button";
        b.textContent = text;
        b.title = label;
        b.setAttribute("aria-label", label);
        b.addEventListener("click", () => {
            if (group.activePanel) {
                act(group.activePanel.id);
            }
        });
        element.append(b);
        return b;
    };
    button("–", "Minimise", onMinimise);
    return {element, maximise: button("□", "Maximise", onMaximise)};
}

/**
 * The rail's buttons for the minimised panels.
 *
 * @param {RailEntry[]} entries - The minimised panels.
 * @param {Map<string, {spec: PanelSpec}>} panels - Every panel, by id.
 * @returns {{id: string, title: string, icon: string}[]} One item per minimised panel.
 */
function railItems(entries, panels) {
    return entries.map(({id}) => {
        const {title, icon} = /** @type {{spec: PanelSpec}} */ (panels.get(id)).spec;
        return {id, title, icon};
    });
}

/**
 * Name each maximise button for what it does now: Maximise, or Restore.
 *
 * @param {Set<HTMLButtonElement>} buttons - The buttons.
 * @param {boolean} maximised - Is a group maximised?
 */
function labelMaximiseButtons(buttons, maximised) {
    const label = maximised ? "Restore" : "Maximise";
    for (const b of buttons) {
        b.title = label;
        b.setAttribute("aria-label", label);
    }
}

/** The presenter's workspace: panels docked in dockview, a rail, and a narrow stack.
 *
 * Every panel is drawn once into an element of its own, and dockview renders it with
 * `renderer: "always"`, so a preview's iframe is never moved and never reloads when its
 * panel is dragged. A change the speaker makes is saved for the page's width, except while
 * the page shows the stack or a panel is maximised. Showing a preset saves nothing, so a
 * preset the deck changes later still reaches this device.
 */
export class Workspace {
    /** Build an empty workspace in an element.
     *
     * @param {HTMLElement} element - The element the rail and the dock go in.
     * @param {WorkspaceOptions} options - Where the layouts are saved, the narrow query, and
     *   what the workspace tells its owner.
     */
    constructor(element, {storage, keys, media, onNotice, onSavePreset}) {
        this.element = element;
        this.storage = storage;
        this.keys = keys;
        this.media = media;
        this.onNotice = onNotice;

        /** Each panel's spec, its element and its cleanup, by id, in the order added.
         *
         * @type {Map<string, {spec: PanelSpec, content: HTMLElement, cleanup: () => void}>}
         */
        this.panels = new Map();

        /** The minimised panels, in the order they were minimised.
         *
         * @type {RailEntry[]}
         */
        this.railEntries = [];

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

        /** Is the workspace changing the dock itself? What that fires is not the speaker's.
         *
         * @type {boolean}
         */
        this.arranging = false;

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

        /** The maximise button of each group header, relabelled when maximise changes.
         *
         * @type {Set<HTMLButtonElement>}
         */
        this.maximiseButtons = new Set();

        const doc = element.ownerDocument;
        this.rail = new Rail(doc, {
            onRestore: id => this.restore(id),
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
        element.append(this.rail.element, root);

        this.dock = createDockview(root, {
            theme: themeLight,
            defaultRenderer: "always",
            // Pointer events, not HTML5 drag and drop: a tab dragged over an iframe still docks.
            dndStrategy: "pointer",
            disableFloatingGroups: true,
            // A tab is its title only: a panel is minimised, never closed.
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
            },
            createRightHeaderActionComponent: group => {
                const actions = groupActions(
                    group,
                    id => this.minimise(id),
                    id => this.maximise(id)
                );
                this.maximiseButtons.add(actions.maximise);
                return {
                    element: actions.element,
                    init: () =>
                        labelMaximiseButtons(this.maximiseButtons, this.dock.hasMaximizedGroup()),
                    dispose: () => this.maximiseButtons.delete(actions.maximise)
                };
            }
        });
        this.subscriptions = [
            this.dock.onDidLayoutChange(() => this.save()),
            this.dock.onDidMaximizedGroupChange(() =>
                labelMaximiseButtons(this.maximiseButtons, this.dock.hasMaximizedGroup())
            )
        ];
        this.onMediaChange = evt => this.setNarrow(evt.matches);
        media.addEventListener("change", this.onMediaChange);
    }

    /** Add a panel at its place in the default layout and draw it.
     *
     * @param {PanelSpec} spec - The panel.
     */
    addPanel(spec) {
        const content = this.rail.element.ownerDocument.createElement("div");
        content.className = "sozi-panel";
        const cleanup = spec.render(content);
        this.panels.set(spec.id, {spec, content, cleanup});
        const {position, inactive} = spec;
        this.dock.addPanel({...panelOptions(spec), position, inactive});
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
     * later presets wait for a reset or a move across the narrow width.
     *
     * @param {Record<string, LayoutPreset>} presets - The presets, in the deck's order.
     */
    offerPresets(presets) {
        this.presets = presets;
        if (!this.offered) {
            this.offered = true;
            if (!this.savedLayout()) {
                this.whileArranging(() => this.showPreset());
            }
        }
    }

    /** The current layout, in its stored form.
     *
     * @readonly
     * @type {import("../protocol/layoutPresets.js").PresetLayout}
     */
    get layout() {
        return layoutOf(
            this.dock.toJSON(),
            this.railEntries.map(e => ({...e}))
        );
    }

    /** Move a panel to the rail; its button there puts it back.
     *
     * @param {string} id - The panel's id.
     */
    minimise(id) {
        const panel = this.dock.getPanel(id);
        if (!panel || this.stacked) {
            return;
        }
        if (this.dock.hasMaximizedGroup()) {
            this.dock.exitMaximizedGroup();
        }
        this.railEntries.push({id, group: panel.group.id});
        this.rail.show(railItems(this.railEntries, this.panels));
        this.dock.removePanel(panel);
        this.save();
    }

    /** Put a minimised panel back in its group, or right of the dock if the group is gone.
     *
     * @param {string} id - The panel's id.
     */
    restore(id) {
        const entry = this.railEntries.find(e => e.id === id);
        if (!entry) {
            return;
        }
        this.railEntries = this.railEntries.filter(e => e !== entry);
        this.rail.show(railItems(this.railEntries, this.panels));
        const group = entry.group === null ? undefined : this.dock.getGroup(entry.group);
        const position = group ? {referenceGroup: group.id} : {direction: "right"};
        const {spec} = /** @type {{spec: PanelSpec}} */ (this.panels.get(id));
        this.dock.addPanel({...panelOptions(spec), position});
        this.save();
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

    /** Forget the layout saved for this width, and go back to the preset or the default. */
    reset() {
        this.storage.removeItem(this.slot);
        this.arrange();
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
     * queued after them all, ends the guard once they have been told.
     *
     * @param {() => void} change - What changes the dock.
     */
    whileArranging(change) {
        this.arranging = true;
        change();
        queueMicrotask(() => (this.arranging = false));
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
        // Cast: the workspace's page is showing, so it has a window.
        const {innerWidth} = /** @type {Window} */ (this.element.ownerDocument.defaultView);
        /** @type {string[]} */
        const failed = [];
        let pick = pickPreset(this.presets, innerWidth, ids);
        const {refused} = pick;
        while (pick.layout && !this.showLayout(pick.layout)) {
            failed.push(/** @type {string} */ (pick.name));
            pick = pickPreset(this.presets, innerWidth, ids, failed);
        }
        const unusable = [...new Set([...refused, ...pick.refused, ...failed])];
        if (unusable.length) {
            this.onNotice(`This page cannot use the deck's layout: ${unusable.join(", ")}.`);
        }
        return pick.layout !== null;
    }

    /** Show a layout: its dock, and its panels on the rail.
     *
     * @param {SavedLayout} layout - The layout.
     * @returns {boolean} False if dockview refused its dock, which leaves the default one.
     */
    showLayout(layout) {
        if (this.dock.hasMaximizedGroup()) {
            this.dock.exitMaximizedGroup();
        }
        this.setStacked(false);
        let shown = true;
        this.railEntries = layout.rail.map(entry => ({...entry}));
        try {
            this.dock.fromJSON(layout.dock, {reuseExistingPanels: true});
        } catch {
            // A dock that dockview cannot read is a layout that cannot be used.
            shown = false;
            this.railEntries = [];
            this.dock.fromJSON(this.defaultDock, {reuseExistingPanels: true});
        }
        this.rail.show(railItems(this.railEntries, this.panels));
        for (const {id} of this.railEntries) {
            const panel = this.dock.getPanel(id);
            if (panel) {
                this.dock.removePanel(panel);
            }
        }
        return shown;
    }

    /** Save the layout for the page's width, unless the speaker did not change it. */
    save() {
        const noChange = !this.opened || this.arranging || this.stacked;
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

    /** Say whether the page shows the stack, which has no rail and no header buttons.
     *
     * @param {boolean} stacked - Does it?
     */
    setStacked(stacked) {
        this.stacked = stacked;
        this.element.classList.toggle("sozi-workspace--stack", stacked);
    }

    /** Show every panel as one stack of tabs.
     *
     * The first panel added leads the stack; minimised panels are tabs of it too.
     */
    showStack() {
        if (this.dock.hasMaximizedGroup()) {
            this.dock.exitMaximizedGroup();
        }
        // Set first, so that the moves below are not saved.
        this.setStacked(true);
        this.railEntries = [];
        this.rail.show([]);
        const specs = [...this.panels.values()].map(p => p.spec);
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

    /** Remove the dock, the rail and every panel, and stop listening. */
    dispose() {
        this.media.removeEventListener("change", this.onMediaChange);
        for (const s of this.subscriptions) {
            s.dispose();
        }
        this.dock.dispose();
        this.rail.dispose();
        for (const {cleanup} of this.panels.values()) {
            cleanup();
        }
        this.panels.clear();
    }
}
