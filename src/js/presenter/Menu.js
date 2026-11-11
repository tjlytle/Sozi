/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

/**
 * An item of a menu.
 *
 * @typedef {object} MenuItem
 * @property {string} label - Its accessible name, and the text it shows.
 * @property {string} [icon] - A glyph before the label, hidden from assistive technology.
 * @property {string} [description] - One line under the label, its accessible description.
 * @property {boolean} [disabled] - Is it shown but not chosen?
 * @property {() => void} [onSelect] - What choosing it does.
 * @property {() => MenuItem[]} [submenu] - The items of the menu it opens instead.
 */

/**
 * What a menu is built with.
 *
 * @typedef {object} MenuOptions
 * @property {string} label - The accessible name of its button and its list.
 * @property {string} text - The text its button shows.
 * @property {string} [empty] - What the list says when it has no items.
 * @property {() => MenuItem[]} items - Its items, asked for each time it opens.
 */

/** The keys that move the focus in a list, and where each moves it from the index of the
 * focused item and the number of items.
 *
 * @readonly
 * @type {Readonly<Record<string, (index: number, count: number) => number>>}
 */
const MOVES = Object.freeze({
    ArrowDown: (i, n) => (i + 1) % n,
    ArrowUp: (i, n) => (i - 1 + n) % n,
    Home: () => 0,
    End: (_i, n) => n - 1
});

/**
 * An empty list that shows as a popover.
 *
 * @param {Document} doc - The page.
 * @param {string} label - Its accessible name.
 * @returns {HTMLElement} The list.
 */
function popoverList(doc, label) {
    const list = doc.createElement("div");
    list.className = "sozi-menu__list";
    list.setAttribute("role", "menu");
    list.setAttribute("aria-label", label);
    list.setAttribute("popover", "auto");
    return list;
}

/**
 * Draw one item: its glyph, its label and its description.
 *
 * @param {Document} doc - The page.
 * @param {MenuItem} item - The item.
 * @param {string} descriptionId - The id its description takes.
 * @returns {HTMLElement} Its element.
 */
function drawItem(doc, item, descriptionId) {
    const element = doc.createElement("div");
    element.className = "sozi-menu__item";
    element.setAttribute("role", "menuitem");
    element.setAttribute("tabindex", "-1");
    // Named by its label alone: the glyph is decoration, the description is described-by.
    element.setAttribute("aria-label", item.label);
    if (item.disabled) {
        element.setAttribute("aria-disabled", "true");
    }
    if (item.submenu) {
        element.setAttribute("aria-haspopup", "menu");
    }
    const icon = doc.createElement("span");
    icon.className = "sozi-menu__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.icon || "";
    const label = doc.createElement("span");
    label.className = "sozi-menu__label";
    label.textContent = item.label;
    element.append(icon, label);
    if (item.description) {
        const description = doc.createElement("span");
        description.className = "sozi-menu__description";
        description.setAttribute("id", descriptionId);
        description.textContent = item.description;
        element.setAttribute("aria-describedby", descriptionId);
        element.append(description);
    }
    return element;
}

/**
 * Put a list under the button that opens it, or beside the item that opens it, and keep it
 * inside the page.
 *
 * @param {HTMLElement} list - The list, shown.
 * @param {HTMLElement} from - The button or the item.
 * @param {boolean} beside - Right of it, as a submenu goes, rather than under it.
 */
function place(list, from, beside) {
    const box = from.getBoundingClientRect();
    const size = list.getBoundingClientRect();
    const view = list.ownerDocument.defaultView;
    const width = view ? view.innerWidth : Infinity;
    const height = view ? view.innerHeight : Infinity;
    const left = beside ? box.right : box.left;
    const top = beside ? box.top : box.bottom;
    list.style.left = `${Math.max(0, Math.min(left, width - size.width))}px`;
    list.style.top = `${Math.max(0, Math.min(top, height - size.height))}px`;
}

/** A menu: a button that opens a list of items in a popover, and one submenu at a time.
 *
 * Its items are asked for each time it opens, so they never go stale. The arrow keys, Home
 * and End move between items, Enter and Space choose one, Escape closes the menu (or the
 * submenu) and gives the focus back.
 */
export class Menu {
    /** Build the button and its list, closed.
     *
     * @param {Document} doc - The page the menu is drawn in.
     * @param {MenuOptions} options - Its name and its items.
     */
    constructor(doc, {label, text, empty = "", items}) {
        this.items = items;
        this.empty = empty;

        /** The item of each element of the lists, while they are shown.
         *
         * @type {Map<HTMLElement, MenuItem>}
         */
        this.itemOf = new Map();

        /** The element of the item that opened the submenu.
         *
         * @type {?HTMLElement}
         */
        this.opener = null;

        /** How many descriptions this menu has drawn, which numbers their ids. */
        this.described = 0;
        this.idBase = `sozi-menu-${Math.random().toString(36).slice(2)}`;

        this.element = doc.createElement("div");
        this.element.className = "sozi-menu";

        this.button = doc.createElement("button");
        this.button.type = "button";
        this.button.className = "sozi-menu__button";
        this.button.textContent = text;
        this.button.title = label;
        this.button.setAttribute("aria-label", label);
        this.button.setAttribute("aria-haspopup", "menu");
        this.button.setAttribute("aria-expanded", "false");

        this.list = popoverList(doc, label);
        // Inside the list, so that opening it keeps the list open.
        this.submenu = popoverList(doc, label);
        this.list.append(this.submenu);
        // The button toggles the list itself, so a click on it does not close and reopen it.
        this.button.popoverTargetElement = this.list;
        this.element.append(this.button, this.list);

        this.onBeforeToggle = evt => {
            if (evt.newState === "open") {
                this.show(this.list, this.items());
            }
        };
        this.onToggle = evt => this.toggled(evt.target, evt.newState === "open");
        this.onClick = evt => this.choose(evt.target.closest('[role="menuitem"]'));
        this.onKeyDown = evt => this.key(evt);
        this.list.addEventListener("beforetoggle", this.onBeforeToggle);
        // Toggle events do not bubble: each list has its own listener.
        this.list.addEventListener("toggle", this.onToggle);
        this.submenu.addEventListener("toggle", this.onToggle);
        this.list.addEventListener("click", this.onClick);
        this.list.addEventListener("keydown", this.onKeyDown);
    }

    /** Open the menu, as a click on its button does. */
    open() {
        this.list.showPopover();
    }

    /** Close the menu and its submenu. */
    close() {
        this.list.hidePopover();
    }

    /** Draw the items of a list.
     *
     * @param {HTMLElement} list - The menu's list or its submenu.
     * @param {MenuItem[]} items - The items.
     */
    show(list, items) {
        const doc = list.ownerDocument;
        for (const element of this.itemsIn(list)) {
            this.itemOf.delete(element);
        }
        const elements = items.map(item => {
            const element = drawItem(doc, item, `${this.idBase}-${this.described++}`);
            this.itemOf.set(element, item);
            return element;
        });
        if (!elements.length) {
            const none = doc.createElement("div");
            none.className = "sozi-menu__empty";
            none.setAttribute("role", "none");
            none.textContent = this.empty;
            elements.push(none);
        }
        list.replaceChildren(...elements, ...(list === this.list ? [this.submenu] : []));
    }

    /** Follow a list being shown or hidden: place it and focus its first item.
     *
     * @param {HTMLElement} list - The list.
     * @param {boolean} open - Is it shown now?
     */
    toggled(list, open) {
        if (list === this.list) {
            this.button.setAttribute("aria-expanded", String(open));
        }
        if (open) {
            const isSubmenu = list === this.submenu;
            place(list, isSubmenu && this.opener ? this.opener : this.button, isSubmenu);
            this.focusAt(list, () => 0);
        }
    }

    /** The items of a list, in order.
     *
     * @param {HTMLElement} list - The list.
     * @returns {HTMLElement[]} Its items.
     */
    itemsIn(list) {
        return [...this.itemOf.keys()].filter(e => e.parentElement === list);
    }

    /** Move the focus to an item of a list.
     *
     * @param {HTMLElement} list - The list.
     * @param {(index: number, count: number) => number} where - The index of the item, from
     *   the index of the item that has the focus (-1 for none) and the number of items.
     */
    focusAt(list, where) {
        const items = this.itemsIn(list);
        if (items.length) {
            const index = items.indexOf(/** @type {any} */ (list.ownerDocument.activeElement));
            items[where(index, items.length)].focus();
        }
    }

    /** Choose an item: open its submenu, or close the menu and do what it says.
     *
     * @param {?HTMLElement} element - The item's element.
     */
    choose(element) {
        const item = element && this.itemOf.get(element);
        if (!element || !item || item.disabled) {
            return;
        }
        if (item.submenu) {
            this.submenu.hidePopover();
            this.opener = element;
            this.show(this.submenu, item.submenu());
            this.submenu.showPopover();
            return;
        }
        this.close();
        this.button.focus();
        if (item.onSelect) {
            item.onSelect();
        }
    }

    /** Act on a key pressed in a list.
     *
     * @param {any} evt - The keydown event.
     */
    key(evt) {
        const element = evt.target.closest('[role="menuitem"]');
        const list = element ? element.parentElement : this.list;
        const item = element && this.itemOf.get(element);
        const move = MOVES[evt.key];
        if (move) {
            this.focusAt(list, move);
        } else if (evt.key === "Enter" || evt.key === " ") {
            this.choose(element);
        } else if (evt.key === "ArrowRight" && item && item.submenu) {
            this.choose(element);
        } else if (list === this.submenu && (evt.key === "ArrowLeft" || evt.key === "Escape")) {
            this.submenu.hidePopover();
            if (this.opener) {
                this.opener.focus();
            }
        } else if (evt.key === "Escape") {
            this.close();
            this.button.focus();
        } else {
            return;
        }
        evt.preventDefault();
        evt.stopPropagation();
    }

    /** Remove the listeners and the menu from the page. */
    dispose() {
        this.list.removeEventListener("beforetoggle", this.onBeforeToggle);
        this.list.removeEventListener("toggle", this.onToggle);
        this.submenu.removeEventListener("toggle", this.onToggle);
        this.list.removeEventListener("click", this.onClick);
        this.list.removeEventListener("keydown", this.onKeyDown);
        this.itemOf.clear();
        this.element.remove();
    }
}
