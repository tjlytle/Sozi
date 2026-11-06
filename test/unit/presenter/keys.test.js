import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {isEditableTarget, messageForKey} from "../../../src/js/presenter/keys.js";
import {
    blankMessage,
    jumpToFrameMessage,
    nextMessage,
    previousMessage
} from "../../../src/js/protocol/messages.js";

const none = {shift: false, alt: false, ctrl: false, meta: false};
const shift = {...none, shift: true};
const display = {frameCount: 3, blank: false};

describe("presenter keys", () => {
    test("each presentation key moves the display with a transition", () => {
        for (const key of ["ArrowDown", "PageDown", "ArrowRight", "Enter", " "]) {
            assert.deepEqual(messageForKey(key, none, display), nextMessage(true), key);
        }
        for (const key of ["ArrowUp", "PageUp", "ArrowLeft"]) {
            assert.deepEqual(messageForKey(key, none, display), previousMessage(true), key);
        }
        assert.deepEqual(messageForKey("Home", none, display), jumpToFrameMessage(0, true));
        assert.deepEqual(messageForKey("End", none, display), jumpToFrameMessage(2, true));
    });

    test("Shift moves without a transition", () => {
        assert.deepEqual(messageForKey(" ", shift, display), nextMessage(false));
        assert.deepEqual(messageForKey("PageUp", shift, display), previousMessage(false));
        assert.deepEqual(messageForKey("Home", shift, display), jumpToFrameMessage(0, false));
        assert.deepEqual(messageForKey("End", shift, display), jumpToFrameMessage(2, false));
    });

    test("End on a deck the display has not reported yet goes to the first frame", () => {
        assert.deepEqual(
            messageForKey("End", none, {frameCount: 0, blank: false}),
            jumpToFrameMessage(0, true)
        );
    });

    test("the full stop toggles the blank screen", () => {
        assert.deepEqual(messageForKey(".", none, display), blankMessage(true));
        assert.deepEqual(messageForKey(".", none, {...display, blank: true}), blankMessage(false));
    });

    test("Alt, Ctrl and Meta leave the key to the browser", () => {
        for (const modifier of ["alt", "ctrl", "meta"]) {
            assert.equal(messageForKey(" ", {...none, [modifier]: true}, display), null, modifier);
        }
    });

    test("any other key sends nothing", () => {
        for (const key of ["a", "Escape", "Tab", "F5"]) {
            assert.equal(messageForKey(key, none, display), null, key);
        }
    });

    test("fields a person types into are editable", () => {
        assert.equal(isEditableTarget({localName: "input", type: "text"}), true);
        assert.equal(isEditableTarget({localName: "input", type: "search"}), true);
        assert.equal(isEditableTarget({localName: "textarea"}), true);
        assert.equal(isEditableTarget({localName: "select"}), true);
        assert.equal(isEditableTarget({localName: "div", isContentEditable: true}), true);
    });

    test("buttons, other elements and no target are not editable", () => {
        assert.equal(isEditableTarget({localName: "button"}), false);
        assert.equal(isEditableTarget({localName: "input", type: "button"}), false);
        assert.equal(isEditableTarget({localName: "input", type: "checkbox"}), false);
        assert.equal(isEditableTarget({localName: "div", isContentEditable: false}), false);
        assert.equal(isEditableTarget({localName: "iframe"}), false);
        assert.equal(isEditableTarget(null), false);
    });
});
