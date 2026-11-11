/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {Menu} from "./Menu.js";

/** @typedef {import("./arrangement.js").PanelChoice} PanelChoice */

/**
 * What the bar asks of the workspace, and tells it.
 *
 * @typedef {object} WorkspaceBarOptions
 * @property {() => PanelChoice[]} closed - The panels that are not showing, asked each time
 *   the + menu opens.
 * @property {() => string[]} presets - The names of the layouts to choose, asked each time
 *   the Layouts menu opens.
 * @property {(id: string) => void} onAdd - Called with the id of a panel to show.
 * @property {(name: string) => void} onPreset - Called with the name of a layout to show.
 * @property {() => void} onReset - Called when Reset layout is pressed.
 * @property {() => void} onSavePreset - Called when Save as preset is pressed.
 */

/** The bar on the workspace's left edge: + Add panel, Layouts, Reset layout and Save as
 * preset.
 */
export class WorkspaceBar {
    /** Build the bar.
     *
     * @param {Document} doc - The page the bar is drawn in.
     * @param {WorkspaceBarOptions} options - What its menus list and its buttons do.
     */
    constructor(doc, {closed, presets, onAdd, onPreset, onReset, onSavePreset}) {
        this.element = doc.createElement("nav");
        this.element.className = "sozi-bar";
        this.element.setAttribute("aria-label", "Workspace");

        this.add = new Menu(doc, {
            label: "Add panel",
            text: "+",
            empty: "Every panel is showing",
            items: () =>
                closed().map(({id, title, icon, description}) => ({
                    label: title,
                    icon,
                    description,
                    onSelect: () => onAdd(id)
                }))
        });
        this.layouts = new Menu(doc, {
            label: "Layouts",
            text: "▤",
            items: () => presets().map(name => ({label: name, onSelect: () => onPreset(name)}))
        });

        this.onResetClick = () => onReset();
        this.reset = this.button(doc, "↺", "Reset layout", this.onResetClick);
        this.onSavePresetClick = () => onSavePreset();
        this.savePreset = this.button(doc, "⤓", "Save as preset", this.onSavePresetClick);

        this.element.append(this.add.element, this.layouts.element, this.reset, this.savePreset);
    }

    /** A button of the bar.
     *
     * @param {Document} doc - The page.
     * @param {string} text - What it shows.
     * @param {string} label - Its accessible name.
     * @param {() => void} onClick - What it does.
     * @returns {HTMLButtonElement} The button.
     */
    button(doc, text, label, onClick) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "sozi-bar__button";
        button.textContent = text;
        button.title = label;
        button.setAttribute("aria-label", label);
        button.addEventListener("click", onClick, false);
        return button;
    }

    /** Remove the listeners and the bar from the page. */
    dispose() {
        this.add.dispose();
        this.layouts.dispose();
        this.reset.removeEventListener("click", this.onResetClick, false);
        this.savePreset.removeEventListener("click", this.onSavePresetClick, false);
        this.element.remove();
    }
}
