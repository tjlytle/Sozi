import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {isEditableTarget} from "../../../src/js/protocol/editable.js";

describe("editable targets", () => {
    test("fields a person types into are editable", () => {
        assert.equal(isEditableTarget({localName: "input", type: "text"}), true);
        assert.equal(isEditableTarget({localName: "input", type: "search"}), true);
        assert.equal(isEditableTarget({localName: "textarea"}), true);
        assert.equal(isEditableTarget({localName: "select"}), true);
        assert.equal(isEditableTarget({localName: "div", isContentEditable: true}), true);
    });

    test("buttons, boxes and other elements are not editable", () => {
        assert.equal(isEditableTarget({localName: "button"}), false);
        assert.equal(isEditableTarget({localName: "input", type: "button"}), false);
        assert.equal(isEditableTarget({localName: "input", type: "checkbox"}), false);
        assert.equal(isEditableTarget({localName: "div", isContentEditable: false}), false);
        assert.equal(isEditableTarget({localName: "iframe"}), false);
    });

    test("no target is not editable", () => {
        assert.equal(isEditableTarget(null), false);
    });
});
