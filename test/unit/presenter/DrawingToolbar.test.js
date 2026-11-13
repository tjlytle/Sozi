import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {DrawingToolbar, TOOL_WIDTHS} from "../../../src/js/presenter/DrawingToolbar.js";
import {DisplayMirrorEvents} from "../../../src/js/presenter/DisplayMirror.js";
import {
    EMPTY_DRAWINGS,
    PenTools,
    drawingClearMessage,
    drawingUndoMessage,
    drawingVisibleMessage
} from "../../../src/js/protocol/drawings.js";
import {drawingsSvg} from "../../../src/js/presenter/drawingsSvg.js";

const canvas = {viewBox: [0, 0, 800, 600], width: "800", height: "600"};
const points = [
    [10, 10, 0.5],
    [60, 10, 0.5]
];
const drawn = {
    visible: true,
    strokes: [{id: "s1", tool: "pen", color: "#e53935", width: 4, points, done: true}]
};

/** An element with what the toolbar uses of one. */
class FakeElement {
    /** Create an element.
     *
     * @param {string} localName - Its tag.
     */
    constructor(localName) {
        this.localName = localName;
        this.children = [];
        this.className = "";
        this.textContent = "";
        this.type = "";
        this.attributes = new Map();
        this.listeners = new Map();
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
        this.attributes.set(name, String(value));
    }

    /** Read an attribute.
     *
     * @param {string} name - Its name.
     * @returns {?string} - Its value.
     */
    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    /** Listen for an event.
     *
     * @param {string} name - The event.
     * @param {Function} listener - The listener.
     */
    addEventListener(name, listener) {
        this.listeners.set(name, listener);
    }

    /** Hand an event to the element's listener.
     *
     * @param {string} name - The event.
     * @returns {any} - The event.
     */
    fire(name) {
        const evt = {
            type: name,
            prevented: false,
            preventDefault() {
                this.prevented = true;
            }
        };
        this.listeners.get(name)?.(evt);
        return evt;
    }

    /** Take the element out of its parent. */
    remove() {
        this.removed = true;
    }

    /** Every element under this one, in order.
     *
     * @returns {FakeElement[]} - The elements.
     */
    descendants() {
        return this.children.flatMap(child => [child, ...child.descendants()]);
    }
}

const doc = {createElement: localName => new FakeElement(localName)};

/** A toolbar on a fake mirror, panel handle and downloads, with what it sends, the tools it sets
 * and the files it saves.
 *
 * @param {object} [options] - The handle, or null for none.
 * @param {any} [options.panel] - The panel handle.
 * @returns {any} - The toolbar, the mirror, the handle, the messages, the tools and the saved
 *   files, each as `[fileName, text, type]`.
 */
function toolbarOn({panel = fakeHandle()} = {}) {
    const mirror = Object.assign(new EventEmitter(), {
        drawings: EMPTY_DRAWINGS,
        deckId: "basic",
        canvas
    });
    const sent = [];
    const tools = [];
    const saved = [];
    const downloads = {download: (...file) => saved.push(file)};
    const toolbar = new DrawingToolbar(/** @type {any} */ (doc), {
        mirror: /** @type {any} */ (mirror),
        send: message => sent.push(message),
        panel,
        onTool: tool => tools.push(tool),
        downloads: /** @type {any} */ (downloads)
    });
    return {toolbar, mirror, panel, sent, tools, saved};
}

/** A panel handle that records what is asked of it.
 *
 * @returns {any} - The handle; `change()` calls its listeners.
 */
function fakeHandle() {
    const listeners = new Set();
    return {
        maximised: false,
        maximises: 0,
        maximise() {
            this.maximises++;
        },
        onMaximisedChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        change() {
            this.maximised = !this.maximised;
            for (const fn of listeners) {
                fn();
            }
        },
        listeners
    };
}

/** The toolbar's button of a name, as a screen reader reads it.
 *
 * @param {DrawingToolbar} toolbar - The toolbar.
 * @param {string} name - The name.
 * @returns {any} - The button, or undefined.
 */
function button(toolbar, name) {
    return /** @type {any} */ (toolbar.element)
        .descendants()
        .find(
            el =>
                el.localName === "button" &&
                (el.getAttribute("aria-label") ?? el.textContent) === name
        );
}

describe("DrawingToolbar", () => {
    test("starts in pan mode with the pen, and its toggle says so", () => {
        const {toolbar} = toolbarOn();
        assert.equal(toolbar.state.draw, false);
        assert.equal(toolbar.state.tool, PenTools.pen);
        assert.equal(button(toolbar, "Draw").getAttribute("aria-pressed"), "false");
        assert.equal(button(toolbar, "Pen").getAttribute("aria-pressed"), "true");
        assert.equal(toolbar.element.getAttribute("role"), "toolbar");
    });

    test("Draw turns draw mode on and off, and hands the tool on", () => {
        const {toolbar, tools} = toolbarOn();
        button(toolbar, "Draw").fire("click");
        assert.equal(button(toolbar, "Draw").getAttribute("aria-pressed"), "true");
        assert.equal(tools.at(-1).draw, true);
        button(toolbar, "Draw").fire("click");
        assert.equal(tools.at(-1).draw, false);
    });

    test("a tool and a colour are chosen, with the tool's width", () => {
        const {toolbar, tools} = toolbarOn();
        button(toolbar, "Highlighter").fire("click");
        button(toolbar, "Blue").fire("click");
        const tool = tools.at(-1);
        assert.equal(tool.tool, PenTools.highlighter);
        assert.match(tool.color, /^#[0-9a-f]{6}$/);
        assert.equal(tool.width, TOOL_WIDTHS.highlighter);
        assert.ok(TOOL_WIDTHS.highlighter > TOOL_WIDTHS.pen);
        assert.equal(button(toolbar, "Highlighter").getAttribute("aria-pressed"), "true");
        assert.equal(button(toolbar, "Pen").getAttribute("aria-pressed"), "false");
        assert.equal(button(toolbar, "Blue").getAttribute("aria-pressed"), "true");
        assert.equal(button(toolbar, "Red").getAttribute("aria-pressed"), "false");
        button(toolbar, "Eraser").fire("click");
        assert.equal(tools.at(-1).tool, PenTools.eraser);
    });

    test("the four colours are all different", () => {
        const {toolbar, tools} = toolbarOn();
        for (const name of ["Red", "Blue", "Green", "Yellow"]) {
            button(toolbar, name).fire("click");
        }
        assert.equal(new Set(tools.map(tool => tool.color)).size, 4);
    });

    test("Undo, Clear and Hide send their messages", () => {
        const {toolbar, sent} = toolbarOn();
        button(toolbar, "Undo").fire("click");
        button(toolbar, "Clear").fire("click");
        button(toolbar, "Hide drawings").fire("click");
        assert.deepEqual(sent, [
            drawingUndoMessage(),
            drawingClearMessage(),
            drawingVisibleMessage(false)
        ]);
    });

    test("Hide becomes Show while the display hides the drawings", () => {
        const {toolbar, mirror, sent} = toolbarOn();
        mirror.drawings = {...EMPTY_DRAWINGS, visible: false};
        mirror.emit(DisplayMirrorEvents.change, {drawings: mirror.drawings});
        assert.equal(button(toolbar, "Hide drawings"), undefined);
        button(toolbar, "Show drawings").fire("click");
        assert.deepEqual(sent, [drawingVisibleMessage(true)]);
    });

    test("Maximise asks the panel, and reads Restore while it is maximised", () => {
        const {toolbar, panel} = toolbarOn();
        button(toolbar, "Maximise").fire("click");
        assert.equal(panel.maximises, 1);
        panel.change();
        assert.equal(button(toolbar, "Maximise"), undefined);
        button(toolbar, "Restore").fire("click");
        assert.equal(panel.maximises, 2);
    });

    test("without a panel handle there is no Maximise", () => {
        const {toolbar} = toolbarOn({panel: null});
        assert.equal(button(toolbar, "Maximise"), undefined);
    });

    test("Export is disabled while there is no stroke, and follows the mirror", () => {
        const {toolbar, mirror} = toolbarOn();
        assert.equal(button(toolbar, "Export").disabled, true);
        mirror.drawings = drawn;
        mirror.emit(DisplayMirrorEvents.change, {drawings: drawn});
        assert.equal(button(toolbar, "Export").disabled, false);
        mirror.drawings = EMPTY_DRAWINGS;
        mirror.emit(DisplayMirrorEvents.change, {drawings: EMPTY_DRAWINGS});
        assert.equal(button(toolbar, "Export").disabled, true);
    });

    test("Export downloads the drawings as the deck's drawings SVG, hidden ones too", () => {
        const {toolbar, mirror, saved} = toolbarOn();
        mirror.drawings = {...drawn, visible: false};
        mirror.emit(DisplayMirrorEvents.change, {drawings: mirror.drawings});
        button(toolbar, "Export").fire("click");
        assert.deepEqual(saved, [
            ["basic-drawings.svg", drawingsSvg(mirror.drawings, canvas), "image/svg+xml"]
        ]);
    });

    test("Export sits in a group of its own, after Clear", () => {
        const {toolbar} = toolbarOn();
        const groups = /** @type {any} */ (toolbar.element).children;
        const at = name =>
            groups.findIndex(group => group.children.includes(button(toolbar, name)));
        assert.ok(at("Export") > at("Clear"));
        assert.equal(groups[at("Export")].children.length, 1);
    });

    test("a press on the toolbar does not take the focus", () => {
        const {toolbar} = toolbarOn();
        assert.equal(/** @type {any} */ (toolbar.element).fire("pointerdown").prevented, true);
    });

    test("dispose stops following the mirror and the panel, and removes the toolbar", () => {
        const {toolbar, mirror, panel} = toolbarOn();
        toolbar.dispose();
        assert.equal(mirror.listenerCount(DisplayMirrorEvents.change), 0);
        assert.equal(panel.listeners.size, 0);
        assert.equal(/** @type {any} */ (toolbar.element).removed, true);
    });
});
