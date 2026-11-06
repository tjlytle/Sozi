import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {ClockPanel} from "../../../src/js/presenter/panels/ClockPanel.js";
import {DisplayMirrorEvents} from "../../../src/js/presenter/DisplayMirror.js";
import {TransportStatus} from "../../../src/js/protocol/LocalTransport.js";
import {
    timerActionMessage,
    timerTargetMessage,
    TimerActions
} from "../../../src/js/protocol/timer.js";

/** An element with what the panel uses of one; it counts each text it is given. */
class FakeElement {
    /** Create an element.
     *
     * @param {string} localName - Its tag.
     * @param {any} doc - Its document.
     */
    constructor(localName, doc) {
        this.localName = localName;
        this.ownerDocument = doc;
        this.children = [];
        this.className = "";
        this.classes = new Set();
        this.attributes = new Map();
        this.listeners = new Map();
        this.disabled = false;
        this.value = "";
        this.text = "";
        this.textWrites = 0;
        this.classList = {
            toggle: (name, on) => (on ? this.classes.add(name) : this.classes.delete(name))
        };
    }

    /** The element's text.
     *
     * @returns {string} - The text.
     */
    get textContent() {
        return this.text;
    }

    set textContent(text) {
        this.text = text;
        this.textWrites++;
    }

    /** Add children.
     *
     * @param {...any} nodes - The children.
     */
    append(...nodes) {
        this.children.push(...nodes);
    }

    /** Remove every child. */
    replaceChildren() {
        this.children = [];
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
        this.listeners.set(name, listener);
    }

    /** Send an event to the listener.
     *
     * @param {string} name - The event.
     */
    fire(name) {
        this.listeners.get(name)();
    }

    /** The element under this one with a class.
     *
     * @param {string} name - The class.
     * @returns {FakeElement} - The element.
     */
    part(name) {
        return /** @type {FakeElement} */ (allIn(this).find(e => e.className === name));
    }

    /** The button under this one with a text.
     *
     * @param {string} text - The text.
     * @returns {FakeElement} - The button.
     */
    button(text) {
        return /** @type {FakeElement} */ (
            allIn(this).find(e => e.localName === "button" && e.textContent === text)
        );
    }

    /** The only field under this one.
     *
     * @returns {FakeElement} - The field.
     */
    get field() {
        return /** @type {FakeElement} */ (allIn(this).find(e => e.localName === "input"));
    }
}

/** Every element under one, itself first.
 *
 * @param {any} element - The element.
 * @returns {FakeElement[]} - The elements.
 */
function allIn(element) {
    return [element, ...element.children.filter(c => c.children).flatMap(allIn)];
}

/** Stand-in for the window: one interval, run by the test, and a fixed time of day.
 *
 * @returns {any} - The fake host.
 */
function fakeHost() {
    return {
        intervals: new Map(),
        lastId: 0,
        setInterval(callback, ms) {
            this.lastId++;
            this.intervals.set(this.lastId, {callback, ms});
            return this.lastId;
        },
        clearInterval(id) {
            this.intervals.delete(id);
        },
        tick() {
            for (const {callback} of this.intervals.values()) {
                callback();
            }
        },
        Date: class {
            toLocaleTimeString() {
                return "10:42";
            }
        }
    };
}

/** Stand-in for the mirror: what the panel reads, and the elapsed time a test sets.
 *
 * @returns {any} - The fake mirror.
 */
function fakeMirror() {
    const mirror = /** @type {any} */ (new EventEmitter());
    return Object.assign(mirror, {
        frame: {index: 0},
        index: 0,
        frameCount: 2,
        status: TransportStatus.connected,
        timer: {elapsedMs: 0, running: false, targetMs: null},
        elapsedMs: 0,
        elapsedAt() {
            return mirror.elapsedMs;
        },
        report(part) {
            Object.assign(mirror, part);
            mirror.emit(DisplayMirrorEvents.change, part);
        }
    });
}

/** A panel on fakes, with what it has sent.
 *
 * @returns {any} - The panel and its fakes.
 */
function drawnPanel() {
    const doc = {activeElement: null};
    doc.createElement = name => new FakeElement(name, doc);
    const element = new FakeElement("div", doc);
    const mirror = fakeMirror();
    const host = fakeHost();
    const sent = [];
    const panel = new ClockPanel(element, mirror, message => sent.push(message), host);
    return {panel, element, doc, mirror, host, sent};
}

describe("ClockPanel", () => {
    test("shows the time of day, the elapsed time and the frame", () => {
        const {element, mirror} = drawnPanel();
        assert.equal(element.part("sozi-clock__time").textContent, "10:42");
        assert.equal(element.part("sozi-clock__elapsed").textContent, "00:00");
        assert.equal(element.part("sozi-clock__frame").textContent, "1 / 2");
        mirror.report({frame: {index: 1}, index: 1});
        assert.equal(element.part("sozi-clock__frame").textContent, "2 / 2");
    });

    test("shows no frame until the display has said hello", () => {
        const doc = {activeElement: null};
        doc.createElement = name => new FakeElement(name, doc);
        const element = new FakeElement("div", doc);
        const mirror = Object.assign(fakeMirror(), {frame: null});
        new ClockPanel(element, mirror, () => {}, fakeHost());
        assert.equal(element.part("sozi-clock__frame").textContent, "");
    });

    test("ticks at 250 ms", () => {
        const {host} = drawnPanel();
        assert.deepEqual(
            [...host.intervals.values()].map(({ms}) => ms),
            [250]
        );
    });

    test("writes text only when the text changes", () => {
        const {element, mirror, host} = drawnPanel();
        const elapsed = element.part("sozi-clock__elapsed");
        const before = elapsed.textWrites;
        host.tick();
        host.tick();
        assert.equal(elapsed.textWrites, before);
        mirror.elapsedMs = 1000;
        host.tick();
        assert.equal(elapsed.textContent, "00:01");
        assert.equal(elapsed.textWrites, before + 1);
    });

    test("the button sends Start while stopped and Pause while running", () => {
        const {element, mirror, sent} = drawnPanel();
        element.button("Start").fire("click");
        assert.deepEqual(sent, [timerActionMessage(TimerActions.start)]);
        mirror.report({timer: {elapsedMs: 0, running: true, targetMs: null}});
        assert.equal(element.button("Start"), undefined);
        element.button("Pause").fire("click");
        assert.deepEqual(sent[1], timerActionMessage(TimerActions.pause));
    });

    test("Reset sends reset", () => {
        const {element, sent} = drawnPanel();
        element.button("Reset").fire("click");
        assert.deepEqual(sent, [timerActionMessage(TimerActions.reset)]);
    });

    test("a target in the field is sent, in milliseconds; an empty field clears it", () => {
        const {element, sent} = drawnPanel();
        element.field.value = "5";
        element.field.fire("change");
        element.field.value = "";
        element.field.fire("change");
        assert.deepEqual(sent, [timerTargetMessage(300000), timerTargetMessage(null)]);
    });

    test("text that is no target sends nothing and puts the target back", () => {
        const {element, mirror, sent} = drawnPanel();
        mirror.report({timer: {elapsedMs: 0, running: false, targetMs: 300000}});
        element.field.value = "abc";
        element.field.fire("change");
        assert.deepEqual(sent, []);
        assert.equal(element.field.value, "5");
    });

    test("the field follows the display, but not while the speaker is in it", () => {
        const {element, doc, mirror} = drawnPanel();
        mirror.report({timer: {elapsedMs: 0, running: false, targetMs: 300000}});
        assert.equal(element.field.value, "5");
        doc.activeElement = element.field;
        element.field.value = "7";
        mirror.report({timer: {elapsedMs: 0, running: false, targetMs: 600000}});
        assert.equal(element.field.value, "7");
    });

    test("the digits and the remaining time follow the target", () => {
        const {element, mirror, host} = drawnPanel();
        const elapsed = element.part("sozi-clock__elapsed");
        const remaining = element.part("sozi-clock__remaining");
        assert.equal(remaining.textContent, "");

        mirror.report({timer: {elapsedMs: 0, running: true, targetMs: 100000}});
        mirror.elapsedMs = 80000;
        host.tick();
        assert.deepEqual([...elapsed.classes], ["sozi-clock__elapsed--near"]);
        assert.equal(remaining.textContent, "00:20 left");

        mirror.elapsedMs = 110000;
        host.tick();
        assert.deepEqual([...elapsed.classes], ["sozi-clock__elapsed--over"]);
        assert.equal(remaining.textContent, "00:10 over");

        mirror.report({timer: {elapsedMs: 110000, running: true, targetMs: null}});
        assert.deepEqual([...elapsed.classes], []);
        assert.equal(remaining.textContent, "");
    });

    test("every control is disabled while the display cannot be reached", () => {
        const {element, mirror} = drawnPanel();
        const controls = () => [element.button("Start"), element.button("Reset"), element.field];
        assert.deepEqual(
            controls().map(c => c.disabled),
            [false, false, false]
        );
        mirror.report({status: TransportStatus.closed});
        assert.deepEqual(
            controls().map(c => c.disabled),
            [true, true, true]
        );
    });

    test("the field is labelled, and the elapsed time is a timer", () => {
        const {element} = drawnPanel();
        const label = allIn(element).find(e => e.localName === "label");
        assert.ok(label.children.includes("Target (min)"));
        assert.ok(label.children.includes(element.field));
        assert.equal(element.part("sozi-clock__elapsed").attributes.get("role"), "timer");
    });

    test("dispose leaves nothing registered and empties the element", () => {
        const {panel, element, mirror, host} = drawnPanel();
        panel.dispose();
        assert.equal(host.intervals.size, 0);
        assert.equal(mirror.listenerCount(DisplayMirrorEvents.change), 0);
        assert.deepEqual(element.children, []);
    });
});
