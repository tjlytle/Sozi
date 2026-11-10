import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {PresetForm} from "../../../src/js/presenter/PresetForm.js";

/** An element with what the form uses of one. */
class FakeElement {
    /** Create an element.
     *
     * @param {string} localName - Its tag.
     */
    constructor(localName) {
        this.localName = localName;
        this.children = [];
        this.listeners = new Map();
        this.attributes = new Map();
        this.hidden = false;
        this.value = "";
        this.textContent = "";
        this.clicks = 0;
        this.focused = false;
        this.removed = false;
    }

    /** Add children.
     *
     * @param {...any} nodes - The children.
     */
    append(...nodes) {
        this.children.push(...nodes);
    }

    /** Set an attribute.
     *
     * @param {string} name - Its name.
     * @param {string} value - Its value.
     */
    setAttribute(name, value) {
        this.attributes.set(name, value);
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

    /** Send an event to the listeners.
     *
     * @param {string} name - The event.
     * @param {object} [evt] - Its fields.
     */
    fire(name, evt = {}) {
        for (const listener of this.listeners.get(name) ?? []) {
            listener({preventDefault() {}, stopPropagation() {}, ...evt});
        }
    }

    /** Take the focus. */
    focus() {
        this.focused = true;
    }

    /** Count a click. */
    click() {
        this.clicks++;
    }

    /** Leave the page. */
    remove() {
        this.removed = true;
    }
}

/** Build a form on fakes.
 *
 * @param {object} [changes] - The options that differ.
 * @returns {any} - The form and its fakes.
 */
function fakeForm(changes = {}) {
    const anchors = [];
    const doc = /** @type {any} */ ({
        createElement: name => {
            const element = new FakeElement(name);
            if (name === "a") {
                anchors.push(element);
            }
            return element;
        }
    });
    const timers = new Map();
    const created = [];
    const revoked = [];
    const host = {
        Blob: class {
            /** Keep what the blob holds.
             *
             * @param {string[]} parts - Its text.
             * @param {object} options - Its type.
             */
            constructor(parts, options) {
                this.parts = parts;
                this.options = options;
            }
        },
        URL: {
            createObjectURL: blob => {
                created.push(blob);
                return `blob:${created.length}`;
            },
            revokeObjectURL: url => revoked.push(url)
        },
        setTimeout: fn => {
            const id = timers.size + 1;
            timers.set(id, fn);
            return id;
        },
        clearTimeout: id => timers.delete(id)
    };
    const saved = [];
    const form = new PresetForm(doc, host, {
        deckId: "talk",
        width: () => 1280,
        layout: () => ({version: 1, dock: {}, rail: []}),
        onSaved: text => saved.push(text),
        ...changes
    });
    return {form, anchors, created, revoked, saved, timers};
}

/** Every element in a tree.
 *
 * @param {any} element - The root.
 * @returns {any[]} - It and its descendants.
 */
function allElements(element) {
    return [element, ...element.children.filter(c => c.children).flatMap(allElements)];
}

describe("PresetForm", () => {
    test("is hidden until it is opened, then starts on the page's width class", () => {
        const {form} = fakeForm({width: () => 390});
        assert.equal(form.element.hidden, true);
        form.open();
        assert.equal(form.element.hidden, false);
        assert.equal(form.match.value, "phone");
        assert.equal(form.name.focused, true);
    });

    test("a bad name blocks saving and says why", () => {
        const {form, created, saved} = fakeForm();
        form.open();
        for (const name of ["", "my talk", "1a"]) {
            form.name.value = name;
            form.element.fire("submit");
            assert.notEqual(form.error.textContent, "", name);
        }
        assert.equal(created.length, 0);
        assert.equal(saved.length, 0);
        assert.equal(form.element.hidden, false);
    });

    test("saving downloads the file, says what to run, and closes", () => {
        const {form, anchors, created, saved} = fakeForm();
        form.open();
        form.name.value = "mine";
        form.match.value = "laptop";
        form.element.fire("submit");

        assert.equal(anchors.length, 1);
        assert.equal(anchors[0].download, "talk.mine.layout.json");
        assert.equal(anchors[0].href, "blob:1");
        assert.equal(anchors[0].clicks, 1);
        assert.deepEqual(JSON.parse(created[0].parts[0]), {
            match: "laptop",
            layout: {version: 1, dock: {}, rail: []}
        });
        assert.equal(saved.length, 1);
        assert.match(saved[0], /sozi --cli set talk\.sozi\.json/);
        assert.match(saved[0], /--layout mine=talk\.mine\.layout\.json/);
        assert.match(saved[0], /build the deck again/);
        assert.equal(form.element.hidden, true);
    });

    test("a page does not reload when the form is sent", () => {
        const {form} = fakeForm();
        let prevented = false;
        form.open();
        form.element.fire("submit", {
            preventDefault() {
                prevented = true;
            }
        });
        assert.equal(prevented, true);
    });

    test("the URL is revoked once the download has had time to start", () => {
        const {form, revoked, timers} = fakeForm();
        form.open();
        form.name.value = "mine";
        form.element.fire("submit");
        assert.deepEqual(revoked, []);
        [...timers.values()][0]();
        assert.deepEqual(revoked, ["blob:1"]);
    });

    test("keys stay in the form, and Escape closes it", () => {
        const {form} = fakeForm();
        let stopped = 0;
        form.open();
        form.element.fire("keydown", {key: " ", stopPropagation: () => stopped++});
        assert.equal(stopped, 1);
        assert.equal(form.element.hidden, false);
        form.element.fire("keydown", {key: "Escape", stopPropagation: () => stopped++});
        assert.equal(stopped, 2);
        assert.equal(form.element.hidden, true);
    });

    test("opening again clears the last error", () => {
        const {form} = fakeForm();
        form.open();
        form.element.fire("submit");
        form.open();
        assert.equal(form.error.textContent, "");
    });

    test("dispose removes every listener and the form, and revokes a waiting URL", () => {
        const {form, revoked, timers} = fakeForm();
        const elements = allElements(form.element);
        form.open();
        form.name.value = "mine";
        form.element.fire("submit");
        form.dispose();
        for (const element of elements) {
            for (const [name, listeners] of element.listeners) {
                assert.deepEqual(listeners, [], `${element.localName} ${name}`);
            }
        }
        assert.equal(form.element.removed, true);
        assert.deepEqual(revoked, ["blob:1"]);
        assert.equal(timers.size, 0);
    });
});
