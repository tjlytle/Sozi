/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

/**
 * A panel as the rail shows it.
 *
 * @typedef {object} RailItem
 * @property {string} id - The panel's id.
 * @property {string} title - Its title, the button's accessible name.
 * @property {string} icon - The text the button shows.
 */

/**
 * What the rail's buttons do.
 *
 * @typedef {object} RailOptions
 * @property {(id: string) => void} onRestore - Called with the id of a panel to put back.
 * @property {() => void} onReset - Called when Reset layout is pressed.
 */

/** The rail on the workspace's left edge: a button per minimised panel, and Reset layout. */
export class Rail {
    /** Build the rail, empty.
     *
     * @param {Document} doc - The page the rail is drawn in.
     * @param {RailOptions} options - What its buttons do.
     */
    constructor(doc, {onRestore, onReset}) {
        this.element = doc.createElement("nav");
        this.element.className = "sozi-rail";
        this.element.setAttribute("aria-label", "Minimised panels");

        this.list = doc.createElement("div");
        this.list.className = "sozi-rail__panels";
        this.onListClick = evt => {
            const button = evt.target.closest("button");
            if (button) {
                onRestore(button.dataset.panel);
            }
        };
        this.list.addEventListener("click", this.onListClick, false);

        this.reset = doc.createElement("button");
        this.reset.type = "button";
        this.reset.className = "sozi-rail__reset";
        this.reset.textContent = "↺";
        this.reset.title = "Reset layout";
        this.reset.setAttribute("aria-label", "Reset layout");
        this.onResetClick = () => onReset();
        this.reset.addEventListener("click", this.onResetClick, false);

        this.element.append(this.list, this.reset);
    }

    /** Show a button for each minimised panel, in order.
     *
     * @param {RailItem[]} items - The minimised panels.
     */
    show(items) {
        const doc = this.element.ownerDocument;
        this.list.replaceChildren(
            ...items.map(({id, title, icon}) => {
                const button = doc.createElement("button");
                button.type = "button";
                button.className = "sozi-rail__panel";
                button.dataset.panel = id;
                button.textContent = icon;
                button.title = title;
                button.setAttribute("aria-label", title);
                return button;
            })
        );
    }

    /** Remove the listeners and the rail from the page. */
    dispose() {
        this.list.removeEventListener("click", this.onListClick, false);
        this.reset.removeEventListener("click", this.onResetClick, false);
        this.element.remove();
    }
}
