import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {ConnectionPanel} from "../../../src/js/presenter/panels/ConnectionPanel.js";
import {DisplayMirrorEvents} from "../../../src/js/presenter/DisplayMirror.js";
import {TransportStatus} from "../../../src/js/protocol/LocalTransport.js";

/** An element with what the panel uses of one; it counts each text it is given. */
class FakeElement {
    /** Create an element.
     *
     * @param {any} doc - Its document.
     */
    constructor(doc) {
        this.ownerDocument = doc;
        this.children = [];
        this.className = "";
        this.attributes = new Map();
        this.text = "";
        this.textWrites = 0;
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
}

/** Stand-in for the mirror: a status, and a change a test reports.
 *
 * @param {string} status - The status it starts with.
 * @returns {any} - The fake mirror.
 */
function fakeMirror(status) {
    const mirror = /** @type {any} */ (new EventEmitter());
    return Object.assign(mirror, {
        status,
        report(part) {
            Object.assign(mirror, part);
            mirror.emit(DisplayMirrorEvents.change, part);
        }
    });
}

/** A panel on fakes.
 *
 * @param {string} [status] - The status the mirror starts with.
 * @returns {any} - The panel, its element, the line it writes and the mirror.
 */
function drawnPanel(status = TransportStatus.connected) {
    const doc = /** @type {any} */ ({});
    doc.createElement = () => new FakeElement(doc);
    const element = /** @type {any} */ (new FakeElement(doc));
    const mirror = fakeMirror(status);
    const panel = new ConnectionPanel(element, mirror);
    return {panel, element, line: element.children[0], mirror};
}

describe("ConnectionPanel", () => {
    test("names each status a transport can have", () => {
        for (const [status, word] of [
            [TransportStatus.connected, "Connected"],
            [TransportStatus.reconnecting, "Reconnecting"],
            [TransportStatus.stale, "Stale"],
            [TransportStatus.closed, "Closed"]
        ]) {
            assert.equal(drawnPanel(status).line.textContent, word);
        }
    });

    test("shows a status it does not know as it comes", () => {
        assert.equal(drawnPanel("paused").line.textContent, "paused");
    });

    test("redraws on a change with a status, and not on one without", () => {
        const {line, mirror} = drawnPanel(TransportStatus.reconnecting);
        mirror.report({status: TransportStatus.connected});
        assert.equal(line.textContent, "Connected");
        const writes = line.textWrites;
        mirror.report({index: 1});
        assert.equal(line.textWrites, writes);
    });

    test("dispose stops following and empties the element", () => {
        const {panel, element, line, mirror} = drawnPanel();
        panel.dispose();
        assert.deepEqual(element.children, []);
        mirror.report({status: TransportStatus.closed});
        assert.equal(line.textContent, "Connected");
        assert.equal(mirror.listenerCount(DisplayMirrorEvents.change), 0);
    });
});
