// A stand-in for dockview in the workspace's unit tests.

/** What the workspace uses of dockview: panels in groups that can move, the active panel of
 * the dock and of each group, and a dock it can refuse. A window's dock is one too.
 */
export class FakeDock {
    /** Create an empty dock. */
    constructor() {
        this.panels = new Map();
        this.groups = new Map();
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
        const panel = this.panels.get(id);
        panel.group.activePanel = panel;
        this.activeListener({panel});
    }

    /**
     * A group, the same object for every panel in it.
     *
     * @param {string} id - The group's id.
     * @returns {object} The group: its id, its element, its panels in order and its active one.
     */
    group(id) {
        if (!this.groups.has(id)) {
            const panels = this.panels;
            this.groups.set(id, {
                id,
                activePanel: null,
                element: {
                    getBoundingClientRect: () => ({left: 0, top: 0, width: 300, height: 200})
                },
                get panels() {
                    return [...panels.values()].filter(p => p.group.id === id);
                }
            });
        }
        return this.groups.get(id);
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
            group: this.group(groupId),
            toJSON: () => ({id}),
            api: {
                moveTo: ({group, position}) => {
                    this.moves.push({id, group: group.id, position});
                    const beside = position && position !== "center";
                    panel.group = this.group(beside ? this.newGroup() : group.id);
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
     * @param {boolean} [options.inactive] - Does it go behind the group's active panel?
     */
    addPanel({id, position, inactive}) {
        const within =
            position?.direction === "within" && this.panels.get(position.referencePanel ?? "");
        const groupId = position?.referenceGroup ?? (within ? within.group.id : this.newGroup());
        this.place(id, groupId);
        const panel = this.panels.get(id);
        if (!inactive || !panel.group.activePanel) {
            panel.group.activePanel = panel;
        }
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

    /** Fit the dock to its element, which a fake does not have. */
    layout() {}

    /** Remove the dock. */
    dispose() {
        this.disposed = true;
    }

    /**
     * The dock as data.
     *
     * @returns {object} An empty grid, and each panel's group, by id.
     */
    toJSON() {
        const panels = {};
        for (const [id, {group}] of this.panels) {
            panels[id] = {group: group.id};
        }
        return {grid: {root: {type: "branch", data: []}}, panels};
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
