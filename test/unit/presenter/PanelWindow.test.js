import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {PanelWindow} from "../../../src/js/presenter/PanelWindow.js";

/**
 * Something that takes listeners and can tell them.
 *
 * @returns {object} The target.
 */
function fakeTarget() {
    const listeners = new Map();
    return {
        listeners,
        addEventListener(name, listener) {
            listeners.set(name, [...(listeners.get(name) ?? []), listener]);
        },
        removeEventListener(name, listener) {
            listeners.set(
                name,
                (listeners.get(name) ?? []).filter(l => l !== listener)
            );
        },
        fire(name) {
            for (const listener of listeners.get(name) ?? []) {
                listener();
            }
        }
    };
}

/**
 * A window opened on `about:blank`, with what the panel's window uses of it.
 *
 * @returns {object} The window.
 */
function fakeWindow() {
    const head = [];
    const body = [];
    return {
        ...fakeTarget(),
        innerWidth: 300,
        innerHeight: 200,
        closed: false,
        head,
        body,
        document: {
            title: "",
            head: {append: node => head.push(node)},
            body: {replaceChildren: (...nodes) => body.splice(0, body.length, ...nodes)},
            createElement: () => ({ownerDocument: null})
        },
        close() {
            this.closed = true;
        }
    };
}

/**
 * The presenter page's window.
 *
 * @param {?object} opened - What `open` gives: a window, or null when it is blocked.
 * @returns {object} The window and what it was asked to open.
 */
function fakeView(opened) {
    const asked = [];
    return {
        ...fakeTarget(),
        asked,
        screenX: 100,
        screenY: 50,
        document: {styleSheets: [{cssRules: [{cssText: ".a {}"}, {cssText: ".b {}"}]}]},
        open: (...args) => {
            asked.push(args);
            return opened;
        }
    };
}

/**
 * A panel's window, with a fake dock.
 *
 * @param {object} view - The presenter page's window.
 * @returns {object} The window, the docks it built and how often it said it closed.
 */
function panelWindow(view) {
    /** @type {any[]} */
    const docks = [];
    /** @type {boolean[]} */
    const closes = [];
    const window = new PanelWindow(/** @type {any} */ (view), {
        id: "notes",
        title: "Notes",
        box: {left: 10, top: 20, width: 300, height: 200},
        buildDock: root => {
            /** @type {any} */
            const dock = {root, sizes: [], disposed: false};
            dock.layout = (w, h) => dock.sizes.push([w, h]);
            dock.dispose = () => (dock.disposed = true);
            docks.push(dock);
            return dock;
        },
        onClose: () => closes.push(true)
    });
    return {window, docks, closes};
}

describe("PanelWindow", () => {
    test("a blocked window says so and builds nothing", () => {
        const {window, docks} = panelWindow(fakeView(null));
        assert.equal(window.open(), false);
        assert.deepEqual(docks, []);
    });

    test("it opens where the panel was, with the page's styles and the panel's dock", () => {
        const target = fakeWindow();
        const view = fakeView(target);
        const {window, docks} = panelWindow(view);
        assert.equal(window.open(), true);
        const [[url, name, features]] = view.asked;
        assert.equal(url, "");
        assert.equal(name, "sozi-panel notes");
        assert.match(features, /left=110,top=70,width=300,height=200/);
        assert.equal(target.document.title, "Notes");
        assert.equal(target.head[0].textContent, ".a {}\n.b {}");
        assert.equal(docks[0].root, target.body[0]);
        assert.match(target.body[0].className, /sozi-dock/);
        assert.deepEqual(docks[0].sizes, [[300, 200]]);
    });

    test("closing the window tells the workspace and removes the dock", () => {
        const target = fakeWindow();
        const {window, docks, closes} = panelWindow(fakeView(target));
        window.open();
        target.fire("pagehide");
        assert.deepEqual(closes, [true]);
        assert.equal(docks[0].disposed, true);
    });

    test("dispose closes the window without telling the workspace, and stops listening", () => {
        const target = fakeWindow();
        const view = fakeView(target);
        const {window, closes} = panelWindow(view);
        window.open();
        window.dispose();
        assert.equal(target.closed, true);
        assert.deepEqual(closes, []);
        for (const listeners of [...target.listeners.values(), ...view.listeners.values()]) {
            assert.deepEqual(listeners, []);
        }
    });

    test("the presenter page going away closes the window", () => {
        const target = fakeWindow();
        const view = fakeView(target);
        const {window} = panelWindow(view);
        window.open();
        view.fire("pagehide");
        assert.equal(target.closed, true);
    });
});
