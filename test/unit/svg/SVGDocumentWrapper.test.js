import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {SVGDocumentWrapper} from "../../../src/js/svg/SVGDocumentWrapper.js";

/** A stub of an SVG root with what the wrapper reads and writes of one.
 *
 * @param {Record<string, string>} attributes - Its attributes.
 * @returns {any} - The root.
 */
function svgRoot(attributes) {
    const attrs = new Map(Object.entries(attributes));
    return {
        attrs,
        style: {width: "", height: ""},
        getElementsByTagName: () => [],
        getAttribute: name => (attrs.has(name) ? attrs.get(name) : null),
        hasAttribute: name => attrs.has(name),
        setAttribute: (name, value) => attrs.set(name, String(value)),
        removeAttribute: name => attrs.delete(name)
    };
}

/** The wrapper of a stub root, after `removeViewbox`.
 *
 * @param {Record<string, string>} attributes - The root's attributes.
 * @returns {any} - The wrapper and its root.
 */
function viewboxRemoved(attributes) {
    const root = svgRoot(attributes);
    const doc = new SVGDocumentWrapper(root);
    doc.removeViewbox();
    return {doc, root};
}

describe("SVGDocumentWrapper", () => {
    test("removeViewbox records the root's viewBox, width and height, then removes the viewBox", () => {
        const {root} = viewboxRemoved({viewBox: "0 0 800 600", width: "800", height: "600"});
        assert.equal(root.attrs.has("viewBox"), false);
        assert.equal(root.style.width, "100%");
        assert.equal(root.getAttribute("data-sozi-view-box"), "0 0 800 600");
        assert.equal(root.getAttribute("data-sozi-width"), "800");
        assert.equal(root.getAttribute("data-sozi-height"), "600");
    });

    test("removeViewbox records 0 0 width height for a root with no viewBox, in pixels", () => {
        const {root} = viewboxRemoved({width: "1024px", height: "768"});
        assert.equal(root.getAttribute("data-sozi-view-box"), "0 0 1024 768");
        assert.equal(root.getAttribute("data-sozi-width"), "1024px");
        assert.equal(root.getAttribute("data-sozi-height"), "768");
    });

    test("removeViewbox records nothing for a root in millimetres with no viewBox", () => {
        const {root, doc} = viewboxRemoved({width: "210mm", height: "297mm"});
        for (const name of ["data-sozi-view-box", "data-sozi-width", "data-sozi-height"]) {
            assert.equal(root.attrs.has(name), false, name);
        }
        assert.equal(doc.sourceCanvas(), null);
    });

    test("sourceCanvas reads back what removeViewbox recorded", () => {
        const {doc} = viewboxRemoved({viewBox: "-5 0 210 297", width: "210mm", height: "297mm"});
        assert.deepEqual(doc.sourceCanvas(), {
            viewBox: [-5, 0, 210, 297],
            width: "210mm",
            height: "297mm"
        });
    });

    test("sourceCanvas reads a page built before the canvas was recorded as null", () => {
        const doc = new SVGDocumentWrapper(/** @type {any} */ (svgRoot({width: "800"})));
        assert.equal(doc.sourceCanvas(), null);
    });
});
