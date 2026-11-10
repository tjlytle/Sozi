import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {setDisplayed, setVisible} from "../../../src/js/svg/authorStyle.js";

// An element from the author's SVG, as Inkscape writes a layer: an inline display.
// Cast: a stub with a style object stands in for the SVG element.
const authorElement = () =>
    /** @type {any} */ ({style: {display: "inline", visibility: "visible"}});

describe("authorStyle", () => {
    test("setDisplayed(false) replaces the author's inline display with none", () => {
        const element = authorElement();
        setDisplayed(element, false);
        assert.equal(element.style.display, "none");
    });
    test("setDisplayed(true) shows the element again", () => {
        const element = authorElement();
        setDisplayed(element, false);
        setDisplayed(element, true);
        assert.equal(element.style.display, "initial");
    });
    test("setVisible(false) replaces the author's inline visibility with hidden", () => {
        const element = authorElement();
        setVisible(element, false);
        assert.equal(element.style.visibility, "hidden");
    });
    test("setVisible(true) makes the element visible again", () => {
        const element = authorElement();
        setVisible(element, false);
        setVisible(element, true);
        assert.equal(element.style.visibility, "visible");
    });
});
