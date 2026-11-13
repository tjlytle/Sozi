import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {PreviewPanel} from "../../../src/js/presenter/panels/PreviewPanel.js";
import {DisplayMirror} from "../../../src/js/presenter/DisplayMirror.js";
import {Roles, helloMessage} from "../../../src/js/protocol/hello.js";
import {
    blankMessage,
    frameChangeMessage,
    jumpToFrameMessage,
    previewMessage
} from "../../../src/js/protocol/messages.js";
import {
    ON_FRAME,
    cameraMessage,
    cameraMoveMessage,
    cameraResetMessage
} from "../../../src/js/protocol/camera.js";
import {
    EMPTY_DRAWINGS,
    drawingsMessage,
    strokeBeginMessage
} from "../../../src/js/protocol/drawings.js";

const stroke = {id: "s1", tool: "pen", color: "#ff0000", width: 6, points: [[1, 2, 0.5]]};

/** An element with what the panel uses of one. */
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
        this.hidden = false;
        this.textContent = "";
        this.listeners = new Map();
        this.contentWindow = null;
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

    /** Listen to an event.
     *
     * @param {string} type - The event.
     * @param {Function} listener - The listener.
     */
    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    /** Stop listening to an event.
     *
     * @param {string} type - The event.
     */
    removeEventListener(type) {
        this.listeners.delete(type);
    }

    /** Fire an event at the element.
     *
     * @param {string} type - The event.
     */
    fire(type) {
        this.listeners.get(type)?.({type});
    }
}

/** A presenter page with a preview panel in it, its deck loaded but not yet said hello.
 *
 * @param {number} offset - The frame it shows, relative to the current one.
 * @returns {any} - The panel, the mirror, what reached the display and the deck, and a way
 *     to post from the deck.
 */
function loadedPanel(offset) {
    const toDeck = [];
    const deck = {closed: false, postMessage: message => toDeck.push(message)};
    const messageListeners = new Set();
    const host = {
        addEventListener: (type, listener) => messageListeners.add(listener),
        removeEventListener: (type, listener) => messageListeners.delete(listener),
        setInterval: () => 1,
        clearInterval() {}
    };
    const doc = {defaultView: host, createElement: name => new FakeElement(name, doc)};
    const element = new FakeElement("div", doc);
    const mirror = new DisplayMirror();
    const toDisplay = [];
    const panel = new PreviewPanel(
        /** @type {any} */ (element),
        mirror,
        message => toDisplay.push(message),
        {
            offset,
            className: "sozi-current-frame",
            title: "Current",
            src: "basic.sozi.html"
        }
    );
    const [box] = element.children;
    const iframe = box.children.find(child => child.localName === "iframe");
    const button = box.children.find(child => child.localName === "button");
    iframe.contentWindow = deck;
    iframe.fire("load");
    /** Post a message from the deck to the panel.
     *
     * @param {any} data - The message.
     */
    const fromDeck = data => {
        for (const listener of messageListeners) {
            listener({source: deck, data});
        }
    };
    mirror.apply(
        helloMessage(Roles.display, {
            deckId: "basic",
            frameCount: 2,
            viewport: null,
            frame: {index: 0, id: "f1", title: "One", notes: ""},
            frames: [],
            blank: false
        })
    );
    return {panel, mirror, toDisplay, toDeck, fromDeck, button, box, element, messageListeners};
}

const panned = {offFrame: true, zoom: 1, x: -0.1, y: 0};
const move = {x: -0.1, y: 0, zoom: 1, atX: 0, atY: 0};
const deckHello = helloMessage(Roles.display, {
    deckId: "basic",
    frameCount: 2,
    viewport: null,
    frame: {index: 0, id: "f1", title: "One", notes: ""},
    frames: [],
    blank: false
});

describe("PreviewPanel", () => {
    test("the iframe is named after its panel, not its class", () => {
        const {box} = loadedPanel(0);
        const iframe = box.children.find(child => child.localName === "iframe");
        assert.equal(iframe.title, "Current");
        assert.equal(iframe.className, "sozi-current-frame");
    });

    test("the current preview forwards its deck's cameraMove to the display", () => {
        const {fromDeck, toDisplay} = loadedPanel(0);
        fromDeck(cameraMoveMessage(move));
        assert.deepEqual(toDisplay, [cameraMoveMessage(move)]);
    });

    test("another preview forwards no cameraMove", () => {
        const {fromDeck, toDisplay} = loadedPanel(1);
        fromDeck(cameraMoveMessage(move));
        assert.deepEqual(toDisplay, []);
    });

    test("Back to frame is a button, hidden while the camera is on its frame", () => {
        const {button, mirror} = loadedPanel(0);
        assert.equal(button.type, "button");
        assert.equal(button.textContent, "Back to frame");
        assert.equal(button.hidden, true);
        mirror.apply(cameraMessage(panned));
        assert.equal(button.hidden, false);
        mirror.apply(cameraMessage(ON_FRAME));
        assert.equal(button.hidden, true);
    });

    test("Back to frame asks the display for a cameraReset", () => {
        const {button, mirror, toDisplay} = loadedPanel(0);
        mirror.apply(cameraMessage(panned));
        button.fire("click");
        assert.deepEqual(toDisplay, [cameraResetMessage()]);
    });

    test("only the current preview has Back to frame", () => {
        const {button} = loadedPanel(1);
        assert.equal(button, undefined);
    });

    test("the current preview's deck gets the frame, then the view", () => {
        const {fromDeck, toDeck, mirror} = loadedPanel(0);
        mirror.apply(cameraMessage(panned));
        toDeck.length = 0;
        fromDeck(deckHello);
        assert.deepEqual(toDeck, [
            previewMessage(true),
            jumpToFrameMessage(0, false),
            cameraMessage(panned),
            drawingsMessage(EMPTY_DRAWINGS)
        ]);
        toDeck.length = 0;
        mirror.apply(frameChangeMessage({index: 1, id: "f2", title: "Two", notes: ""}));
        mirror.apply(cameraMessage(ON_FRAME));
        assert.deepEqual(toDeck, [
            jumpToFrameMessage(1, false),
            cameraMessage(panned),
            cameraMessage(ON_FRAME)
        ]);
    });

    test("another preview's deck gets its frame and no view", () => {
        const {fromDeck, toDeck, mirror} = loadedPanel(1);
        mirror.apply(cameraMessage(panned));
        toDeck.length = 0;
        fromDeck(deckHello);
        assert.deepEqual(toDeck, [
            previewMessage(false),
            jumpToFrameMessage(1, false),
            drawingsMessage(EMPTY_DRAWINGS)
        ]);
    });

    test("every preview's deck gets the drawings when it is ready and when they change", () => {
        for (const offset of [0, 1]) {
            const {fromDeck, toDeck, mirror} = loadedPanel(offset);
            fromDeck(deckHello);
            toDeck.length = 0;
            mirror.apply(strokeBeginMessage(stroke));
            assert.deepEqual(toDeck, [drawingsMessage(mirror.drawings)], `offset ${offset}`);
        }
    });

    test("a frame change does not send the drawings again", () => {
        const {fromDeck, toDeck, mirror} = loadedPanel(1);
        fromDeck(deckHello);
        toDeck.length = 0;
        mirror.apply(frameChangeMessage({index: 1, id: "f2", title: "Two", notes: ""}));
        assert.deepEqual(toDeck, [blankMessage(true)]);
    });

    test("a deck that has not said hello gets no drawings", () => {
        const {toDeck, mirror} = loadedPanel(0);
        toDeck.length = 0;
        mirror.apply(strokeBeginMessage(stroke));
        assert.deepEqual(toDeck, []);
    });

    test("dispose stops following the camera", () => {
        const {panel, mirror, button, toDeck, fromDeck} = loadedPanel(0);
        fromDeck(deckHello);
        panel.dispose();
        toDeck.length = 0;
        mirror.apply(cameraMessage(panned));
        assert.equal(button.hidden, true);
        assert.deepEqual(toDeck, []);
    });
});
