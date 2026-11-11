/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {Menu} from "./Menu.js";

/** @typedef {import("./Menu.js").MenuItem} MenuItem */
/** @typedef {import("./arrangement.js").PanelChoice} PanelChoice */

/**
 * What the workspace says about a panel when its menu opens.
 *
 * @typedef {object} PanelMenuState
 * @property {boolean} stacked - Is the page showing one stack of tabs? Then Close is all.
 * @property {boolean} canClose - Is another panel showing, so that this one can go?
 * @property {boolean} canPopOut - Can the panel move to a window of its own?
 * @property {boolean} maximised - Is a group maximised? Maximise then restores.
 * @property {PanelChoice[]} others - What Replace with and Split offer.
 */

/**
 * What a panel menu asks of the workspace, and tells it.
 *
 * @typedef {object} PanelMenuOptions
 * @property {(id: string) => PanelMenuState} state - The state of a panel, asked each time
 *   the menu opens, so that no item goes stale.
 * @property {(id: string, withId: string) => void} onReplace - Put a panel in another's place.
 * @property {(id: string, withId: string, direction: "right" | "below") => void} onSplit -
 *   Put a panel beside another.
 * @property {(id: string) => void} onMaximise - Maximise a panel, or restore the layout.
 * @property {(id: string) => void} onPopOut - Move a panel to a window of its own.
 * @property {(id: string) => void} onClose - Close a panel.
 */

/** The ⋯ menu of a group header, for the group's active panel. */
export class PanelMenu {
    /** Build the menu in a group's header.
     *
     * @param {any} group - The dockview group.
     * @param {PanelMenuOptions} options - What the menu asks and tells.
     */
    constructor(group, options) {
        this.group = group;
        this.options = options;
        const doc = group.element.ownerDocument;
        this.menu = new Menu(doc, {label: "Panel menu", text: "⋯", items: () => this.items()});
        this.element = doc.createElement("div");
        this.element.className = "sozi-group-actions";
        this.element.append(this.menu.element);
    }

    /** The items for the group's active panel, as the workspace has it now.
     *
     * @returns {MenuItem[]} The items.
     */
    items() {
        const panel = this.group.activePanel;
        if (!panel) {
            return [];
        }
        const {id} = panel;
        const {onReplace, onSplit, onMaximise, onPopOut, onClose} = this.options;
        const {stacked, canClose, canPopOut, maximised, others} = this.options.state(id);
        const close = {label: "Close", icon: "×", disabled: !canClose, onSelect: () => onClose(id)};
        if (stacked) {
            return [close];
        }
        /** @type {(act: (withId: string) => void) => () => MenuItem[]} */
        const choices = act => () =>
            others.map(({id: withId, title, icon, description}) => ({
                label: title,
                icon,
                description,
                onSelect: () => act(withId)
            }));
        const none = !others.length;
        /** @type {MenuItem[]} */
        const items = [
            {
                label: "Replace with…",
                icon: "⇄",
                disabled: none,
                submenu: choices(w => onReplace(id, w))
            },
            {
                label: "Split right…",
                icon: "◫",
                disabled: none,
                submenu: choices(w => onSplit(id, w, "right"))
            },
            {
                label: "Split below…",
                icon: "⬓",
                disabled: none,
                submenu: choices(w => onSplit(id, w, "below"))
            },
            {label: maximised ? "Restore" : "Maximise", icon: "□", onSelect: () => onMaximise(id)}
        ];
        if (canPopOut) {
            items.push({label: "Pop out", icon: "⧉", onSelect: () => onPopOut(id)});
        }
        return [...items, close];
    }

    /** Remove the menu from the header. */
    dispose() {
        this.menu.dispose();
        this.element.remove();
    }
}
