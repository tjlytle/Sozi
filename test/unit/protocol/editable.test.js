import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {editableField, isEditableTarget} from "../../../src/js/protocol/editable.js";

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

describe("the field a click focuses", () => {
    test("an input takes the focus itself", () => {
        const input = {localName: "input", type: "text"};
        assert.equal(editableField(input), input);
    });

    test("a child of editable content gives the focus to its host", () => {
        const host = {localName: "div", isContentEditable: true, parentElement: null};
        const span = {localName: "span", isContentEditable: true, parentElement: host};
        assert.equal(editableField(span), host);
    });

    test("content nested two levels deep gives the focus to the outermost host", () => {
        const body = {localName: "body", isContentEditable: false, parentElement: null};
        const host = {localName: "div", isContentEditable: true, parentElement: body};
        const bold = {localName: "b", isContentEditable: true, parentElement: host};
        const span = {localName: "span", isContentEditable: true, parentElement: bold};
        assert.equal(editableField(span), host);
    });

    test("an island that is not editable inside a host takes no focus", () => {
        const host = {localName: "div", isContentEditable: true, parentElement: null};
        const island = {localName: "span", isContentEditable: false, parentElement: host};
        assert.equal(editableField(island), null);
    });

    test("a button and no target take no focus", () => {
        assert.equal(editableField({localName: "button"}), null);
        assert.equal(editableField(null), null);
    });
});
