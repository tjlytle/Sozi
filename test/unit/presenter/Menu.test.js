import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {Menu} from "../../../src/js/presenter/Menu.js";

/** An element with what the menu uses of one. */
class FakeElement {
    /** Create an element.
     *
     * @param {FakeDocument} doc - The page it belongs to.
     * @param {string} localName - Its tag.
     */
    constructor(doc, localName) {
        this.ownerDocument = doc;
        this.localName = localName;
        this.parentElement = null;
        this.children = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.style = {};
        this.textContent = "";
        this.open = false;
    }

    /** Add children.
     *
     * @param {...FakeElement} nodes - The children.
     */
    append(...nodes) {
        for (const node of nodes) {
            node.parentElement = this;
        }
        this.children.push(...nodes);
    }

    /** Put other children in place of these.
     *
     * @param {...FakeElement} nodes - The children.
     */
    replaceChildren(...nodes) {
        this.children = [];
        this.append(...nodes);
    }

    /** Leave the parent. */
    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter(c => c !== this);
        }
        this.parentElement = null;
    }

    /** Set an attribute.
     *
     * @param {string} name - Its name.
     * @param {string} value - Its value.
     */
    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    /** Read an attribute.
     *
     * @param {string} name - Its name.
     * @returns {?string} Its value.
     */
    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    /** Is this element, or one of its parents, of a role?
     *
     * @param {string} selector - `[role="…"]`, the only selector the menu uses.
     * @returns {?FakeElement} The nearest one.
     */
    closest(selector) {
        const role = /^\[role="(\w+)"\]$/.exec(selector)?.[1];
        for (let e = this; e; e = e.parentElement) {
            if (e.getAttribute("role") === role) {
                return e;
            }
        }
        return null;
    }

    /** Listen for an event.
     *
     * @param {string} name - The event.
     * @param {Function} listener - The listener.
     */
    addEventListener(name, listener) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    }

    /** Stop listening for an event.
     *
     * @param {string} name - The event.
     * @param {Function} listener - The listener.
     */
    removeEventListener(name, listener) {
        this.listeners.set(
            name,
            (this.listeners.get(name) ?? []).filter(l => l !== listener)
        );
    }

    /** Send an event to this element and, unless it is a popover's, to its parents.
     *
     * @param {string} name - The event.
     * @param {object} [fields] - What the event carries.
     * @returns {object} The event.
     */
    dispatch(name, fields = {}) {
        const bubbles = !["beforetoggle", "toggle"].includes(name);
        const evt = {
            type: name,
            target: this,
            defaultPrevented: false,
            preventDefault() {
                this.defaultPrevented = true;
            },
            stopPropagation() {},
            ...fields
        };
        for (let e = this; e; e = bubbles ? e.parentElement : null) {
            for (const listener of e.listeners.get(name) ?? []) {
                listener(evt);
            }
        }
        return evt;
    }

    /** Show this element as a popover. */
    showPopover() {
        this.dispatch("beforetoggle", {newState: "open"});
        this.open = true;
        this.dispatch("toggle", {newState: "open"});
    }

    /** Hide this element, a popover. */
    hidePopover() {
        if (this.open) {
            this.open = false;
            this.dispatch("toggle", {newState: "closed"});
        }
    }

    /** Take the focus. */
    focus() {
        this.ownerDocument.activeElement = this;
    }

    /** Is a node this one or inside it?
     *
     * @param {any} node - The node.
     * @returns {boolean} True if it is.
     */
    contains(node) {
        for (let e = node; e; e = e.parentElement) {
            if (e === this) {
                return true;
            }
        }
        return false;
    }

    /** Where it is on the page.
     *
     * @returns {object} Its box.
     */
    getBoundingClientRect() {
        return {left: 10, top: 20, right: 40, bottom: 50, width: 30, height: 30};
    }

    /** Every element under this one, in order.
     *
     * @returns {FakeElement[]} The elements.
     */
    descendants() {
        return this.children.flatMap(c => [c, ...c.descendants()]);
    }
}

/** The page the menu is drawn in. */
class FakeDocument {
    /** Create a page. */
    constructor() {
        this.activeElement = null;
        this.defaultView = {innerWidth: 1000, innerHeight: 800};
    }

    /** Create an element.
     *
     * @param {string} localName - Its tag.
     * @returns {FakeElement} The element.
     */
    createElement(localName) {
        return new FakeElement(this, localName);
    }
}

/**
 * The items of a list of a menu.
 *
 * @param {FakeElement} list - The list.
 * @returns {FakeElement[]} Its items, those of its submenu left out.
 */
function itemsOf(list) {
    return list.children.filter(c => c.getAttribute("role") === "menuitem");
}

/**
 * Press a key on the element that has the focus.
 *
 * @param {FakeDocument} doc - The page.
 * @param {string} key - The key.
 * @returns {object} The event.
 */
function press(doc, key) {
    return /** @type {FakeElement} */ (doc.activeElement).dispatch("keydown", {key});
}

/**
 * A menu of three items, the second disabled, the third with a submenu.
 *
 * @returns {object} The menu, its page and what was chosen.
 */
function threeItems() {
    const doc = new FakeDocument();
    const chosen = [];
    const menu = new Menu(/** @type {any} */ (doc), {
        label: "Add panel",
        text: "+",
        empty: "Nothing to add",
        items: () => [
            {
                label: "Clock",
                icon: "◷",
                description: "The talk timer",
                onSelect: () => chosen.push("clock")
            },
            {label: "Close", disabled: true, onSelect: () => chosen.push("close")},
            {
                label: "Split right…",
                submenu: () => [{label: "Notes", onSelect: () => chosen.push("notes")}]
            }
        ]
    });
    return {doc, menu, chosen};
}

describe("Menu", () => {
    test("its button is named and says it opens a menu", () => {
        const {menu} = threeItems();
        assert.equal(menu.button.getAttribute("aria-label"), "Add panel");
        assert.equal(menu.button.getAttribute("aria-haspopup"), "menu");
        assert.equal(menu.button.textContent, "+");
        assert.equal(menu.list.getAttribute("role"), "menu");
    });

    test("opening it lists its items and focuses the first", () => {
        const {doc, menu} = threeItems();
        menu.open();
        const items = itemsOf(menu.list);
        assert.equal(items.length, 3);
        assert.equal(doc.activeElement, items[0]);
        assert.equal(menu.button.getAttribute("aria-expanded"), "true");
    });

    test("an item is named by its label alone, with its glyph hidden and its description linked", () => {
        const {menu} = threeItems();
        menu.open();
        const [clock] = itemsOf(menu.list);
        assert.equal(clock.getAttribute("aria-label"), "Clock");
        const glyph = clock.children.find(c => c.textContent === "◷");
        assert.equal(glyph?.getAttribute("aria-hidden"), "true");
        const id = clock.getAttribute("aria-describedby");
        const description = clock.descendants().find(c => c.getAttribute("id") === id);
        assert.equal(description?.textContent, "The talk timer");
    });

    test("the arrow keys move the focus, round the ends", () => {
        const {doc, menu} = threeItems();
        menu.open();
        const items = itemsOf(menu.list);
        press(doc, "ArrowDown");
        assert.equal(doc.activeElement, items[1]);
        press(doc, "ArrowDown");
        press(doc, "ArrowDown");
        assert.equal(doc.activeElement, items[0]);
        press(doc, "ArrowUp");
        assert.equal(doc.activeElement, items[2]);
        press(doc, "Home");
        assert.equal(doc.activeElement, items[0]);
        press(doc, "End");
        assert.equal(doc.activeElement, items[2]);
    });

    test("choosing an item closes the menu and does what it says", () => {
        const {doc, menu, chosen} = threeItems();
        menu.open();
        itemsOf(menu.list)[0].dispatch("click");
        assert.deepEqual(chosen, ["clock"]);
        assert.equal(menu.list.open, false);
        assert.equal(doc.activeElement, menu.button);
    });

    test("a disabled item is marked and does nothing, by click or by key", () => {
        const {doc, menu, chosen} = threeItems();
        menu.open();
        const close = itemsOf(menu.list)[1];
        assert.equal(close.getAttribute("aria-disabled"), "true");
        close.dispatch("click");
        close.focus();
        press(doc, "Enter");
        assert.deepEqual(chosen, []);
        assert.equal(menu.list.open, true);
    });

    test("Escape closes the menu and gives the focus back to its button", () => {
        const {doc, menu} = threeItems();
        menu.open();
        press(doc, "Escape");
        assert.equal(menu.list.open, false);
        assert.equal(doc.activeElement, menu.button);
        assert.equal(menu.button.getAttribute("aria-expanded"), "false");
    });

    test("an item with a submenu opens it, and its items are chosen like any other", () => {
        const {doc, menu, chosen} = threeItems();
        menu.open();
        const split = itemsOf(menu.list)[2];
        assert.equal(split.getAttribute("aria-haspopup"), "menu");
        split.focus();
        press(doc, "Enter");
        assert.equal(menu.submenu.open, true);
        const [notes] = itemsOf(menu.submenu);
        assert.equal(doc.activeElement, notes);
        press(doc, "Escape");
        assert.equal(menu.submenu.open, false);
        assert.equal(menu.list.open, true);
        assert.equal(doc.activeElement, split);
        press(doc, "ArrowRight");
        itemsOf(menu.submenu)[0].dispatch("click");
        assert.deepEqual(chosen, ["notes"]);
        assert.equal(menu.list.open, false);
    });

    test("a menu with nothing in it says so and has no items", () => {
        const doc = new FakeDocument();
        const menu = /** @type {any} */ (
            new Menu(/** @type {any} */ (doc), {
                label: "Add panel",
                text: "+",
                empty: "Every panel is showing",
                items: () => []
            })
        );
        menu.open();
        assert.deepEqual(itemsOf(menu.list), []);
        assert.ok(menu.list.descendants().some(c => c.textContent === "Every panel is showing"));
    });

    test("dispose removes its listeners and its element", () => {
        const {menu} = threeItems();
        const parent = new FakeElement(/** @type {any} */ (menu.element.ownerDocument), "div");
        parent.append(menu.element);
        menu.dispose();
        assert.deepEqual(parent.children, []);
        for (const element of [menu.button, menu.list, menu.submenu]) {
            for (const listeners of element.listeners.values()) {
                assert.deepEqual(listeners, []);
            }
        }
    });
});
