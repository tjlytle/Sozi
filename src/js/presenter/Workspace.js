/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

// The UMD build is the one that brings dockview's styles with it.
import {createDockview, themeLight} from "dockview-core/dist/dockview-core.js";
import {Rail} from "./Rail.js";
import {readSavedLayout, savedLayoutText} from "./layout.js";

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
 * @property {Storage} storage - Where the layout is saved.
 * @property {string} key - The layout's key in the storage.
 * @property {MediaQueryList} media - Matches while the page shows one stack of tabs.
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
 * panel is dragged. The layout is saved on every change, except while the page is narrow
 * or a panel is maximised.
 */
export class Workspace {
    /** Build an empty workspace in an element.
     *
     * @param {HTMLElement} element - The element the rail and the dock go in.
     * @param {WorkspaceOptions} options - Where the layout is saved, and the narrow query.
     */
    constructor(element, {storage, key, media}) {
        this.storage = storage;
        this.key = key;
        this.media = media;

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

        /** The wide layout last saved or applied, null until `open`; narrow goes back to it.
         *
         * @type {?SavedLayout}
         */
        this.layout = null;

        /** The default dock, as built from the panels' positions.
         *
         * @type {any}
         */
        this.defaultDock = null;

        /** Is the page showing one stack of tabs? Nothing is saved while it is.
         *
         * @type {boolean}
         */
        this.narrow = false;

        /** The maximise button of each group header, relabelled when maximise changes.
         *
         * @type {Set<HTMLButtonElement>}
         */
        this.maximiseButtons = new Set();

        const doc = element.ownerDocument;
        this.rail = new Rail(doc, {
            onRestore: id => this.restore(id),
            onReset: () => this.reset()
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

    /** Size the default layout, remember it, bring back the saved one, and start saving. */
    open() {
        // A group's height is set once every panel is in: a later split would halve it.
        for (const {spec} of this.panels.values()) {
            const panel = this.dock.getPanel(spec.id);
            if (panel && spec.initialHeight) {
                panel.group.api.setSize({height: spec.initialHeight});
            }
        }
        this.defaultDock = this.dock.toJSON();
        const text = this.storage.getItem(this.key);
        const saved = text === null ? null : readSavedLayout(text, [...this.panels.keys()]);
        this.layout = {dock: this.defaultDock, rail: []};
        if (saved) {
            this.layout = saved;
            this.showLayout(saved);
        }
        if (this.media.matches) {
            this.setNarrow(true);
        }
    }

    /** Move a panel to the rail; its button there puts it back.
     *
     * @param {string} id - The panel's id.
     */
    minimise(id) {
        const panel = this.dock.getPanel(id);
        if (!panel || this.narrow) {
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

    /** Bring back the default layout, with no panel on the rail, and save it. */
    reset() {
        this.layout = {dock: this.defaultDock, rail: []};
        if (this.narrow) {
            this.railEntries = [];
            this.rail.show(railItems(this.railEntries, this.panels));
            this.storage.setItem(this.key, savedLayoutText(this.defaultDock, []));
        } else {
            this.showLayout(this.layout);
            this.save();
        }
    }

    /** Show a wide layout: its dock, and its panels on the rail.
     *
     * @param {SavedLayout} layout - The layout.
     */
    showLayout(layout) {
        if (this.dock.hasMaximizedGroup()) {
            this.dock.exitMaximizedGroup();
        }
        this.railEntries = layout.rail.map(entry => ({...entry}));
        try {
            this.dock.fromJSON(layout.dock, {reuseExistingPanels: true});
        } catch {
            // A saved dock that dockview cannot read is a layout that cannot be read.
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
    }

    /** Save the layout, unless it is not yet open, narrow or maximised. */
    save() {
        if (!this.layout || this.narrow || this.dock.hasMaximizedGroup()) {
            return;
        }
        this.layout = {dock: this.dock.toJSON(), rail: this.railEntries.map(e => ({...e}))};
        this.storage.setItem(this.key, savedLayoutText(this.layout.dock, this.layout.rail));
    }

    /** Show every panel as one stack of tabs, or bring back the wide layout.
     *
     * The first panel added leads the stack; minimised panels are tabs of it too.
     *
     * @param {boolean} narrow - Is the page narrow now?
     */
    setNarrow(narrow) {
        if (narrow === this.narrow || !this.layout) {
            return;
        }
        if (!narrow) {
            this.narrow = false;
            this.showLayout(this.layout);
            return;
        }
        if (this.dock.hasMaximizedGroup()) {
            this.dock.exitMaximizedGroup();
        }
        // Set first, so that the moves below are not saved over the wide layout.
        this.narrow = true;
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
