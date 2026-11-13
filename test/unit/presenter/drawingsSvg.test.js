import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    HIGHLIGHTER_OPACITY,
    drawingsFileName,
    drawingsSvg
} from "../../../src/js/presenter/drawingsSvg.js";
import {strokeOutline} from "../../../src/js/protocol/strokeOutline.js";

const canvas = {viewBox: [0, 0, 800, 600], width: "800", height: "600"};

/** A finished stroke along a line, from (x, y) to (x + 100, y).
 *
 * @param {string} id - Its id.
 * @param {string} tool - `pen` or `highlighter`.
 * @param {string} color - Its colour.
 * @param {number} [x] - Where it starts.
 * @param {number} [y] - Where it starts.
 * @returns {any} - The stroke.
 */
function lineStroke(id, tool, color, x = 100, y = 100) {
    const points = Array.from({length: 11}, (_, i) => [x + i * 10, y, 0.5]);
    return {id, tool, color, width: 8, points, done: true};
}

/** The attributes of each element of a name in an SVG text, in order.
 *
 * @param {string} svg - The text.
 * @param {string} name - The element's name.
 * @returns {Record<string, string>[]} - The attributes of each element.
 */
function elements(svg, name) {
    return [...svg.matchAll(new RegExp(`<${name}\\s([^>]*?)/?>`, "g"))].map(([, attrs]) =>
        Object.fromEntries([...attrs.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]))
    );
}

const pen = lineStroke("p1", "pen", "#e53935");
const highlighter = lineStroke("h1", "highlighter", "#fdd835", 200, 300);

describe("drawingsSvg", () => {
    test("is one SVG root with the canvas's viewBox, width and height, and the namespaces", () => {
        const svg = drawingsSvg({visible: true, strokes: [pen]}, canvas);
        const [root] = elements(svg, "svg");
        assert.equal(elements(svg, "svg").length, 1);
        assert.equal(root.xmlns, "http://www.w3.org/2000/svg");
        assert.equal(root["xmlns:inkscape"], "http://www.inkscape.org/namespaces/inkscape");
        assert.equal(root.viewBox, "0 0 800 600");
        assert.equal(root.width, "800");
        assert.equal(root.height, "600");
    });

    test("holds one Inkscape layer named Drawings, with one path per stroke", () => {
        const svg = drawingsSvg({visible: true, strokes: [pen, highlighter]}, canvas);
        const layers = elements(svg, "g");
        assert.equal(layers.length, 1);
        assert.equal(layers[0]["inkscape:groupmode"], "layer");
        assert.equal(layers[0]["inkscape:label"], "Drawings");
        assert.equal(elements(svg, "path").length, 2);
    });

    test("each path is the stroke's outline filled with its colour", () => {
        const [path] = elements(drawingsSvg({visible: true, strokes: [pen]}, canvas), "path");
        assert.equal(path.d, strokeOutline(pen));
        assert.equal(path.fill, "#e53935");
        assert.equal(path["fill-opacity"], undefined);
    });

    test("highlighters come before pens and only they are see-through", () => {
        const second = lineStroke("p2", "pen", "#1e88e5");
        const svg = drawingsSvg({visible: true, strokes: [pen, highlighter, second]}, canvas);
        const paths = elements(svg, "path");
        assert.deepEqual(
            paths.map(p => p.fill),
            ["#fdd835", "#e53935", "#1e88e5"]
        );
        assert.deepEqual(
            paths.map(p => p["fill-opacity"]),
            [String(HIGHLIGHTER_OPACITY), undefined, undefined]
        );
        assert.ok(HIGHLIGHTER_OPACITY > 0 && HIGHLIGHTER_OPACITY < 1);
    });

    test("hidden drawings are exported too", () => {
        const svg = drawingsSvg({visible: false, strokes: [pen, highlighter]}, canvas);
        assert.equal(elements(svg, "path").length, 2);
        assert.doesNotMatch(svg, /hidden|display|visibility/);
    });

    test("a canvas with no width or height gives a root without them", () => {
        const [root] = elements(
            drawingsSvg({visible: true, strokes: [pen]}, {...canvas, width: "", height: ""}),
            "svg"
        );
        assert.equal(root.viewBox, "0 0 800 600");
        assert.equal(root.width, undefined);
        assert.equal(root.height, undefined);
    });

    test("with no canvas, the viewBox holds every outline point and there is no size", () => {
        const svg = drawingsSvg({visible: true, strokes: [pen, highlighter]}, null);
        const [root] = elements(svg, "svg");
        assert.equal(root.width, undefined);
        assert.equal(root.height, undefined);
        const [x, y, w, h] = root.viewBox.split(" ").map(Number);
        assert.ok(w > 0 && h > 0);
        for (const {d} of elements(svg, "path")) {
            const numbers = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
            for (let i = 0; i < numbers.length; i += 2) {
                assert.ok(numbers[i] >= x && numbers[i] <= x + w, `x ${numbers[i]}`);
                assert.ok(numbers[i + 1] >= y && numbers[i + 1] <= y + h, `y ${numbers[i + 1]}`);
            }
        }
        assert.ok(x < 100 && x + w > 300 && y < 100 && y + h > 300);
    });

    test("escapes what it puts in an attribute", () => {
        const odd = {...pen, color: '#000"/><script>'};
        const svg = drawingsSvg({visible: true, strokes: [odd]}, canvas);
        assert.doesNotMatch(svg, /<script>/);
        assert.match(svg, /fill="#000&quot;\/&gt;&lt;script&gt;"/);
    });

    test("a stroke with no point gives no path", () => {
        const empty = {...pen, points: []};
        assert.equal(
            elements(drawingsSvg({visible: true, strokes: [empty]}, canvas), "path").length,
            0
        );
    });
});

describe("drawingsFileName", () => {
    test("is the deck's id followed by -drawings.svg", () => {
        assert.equal(drawingsFileName("basic"), "basic-drawings.svg");
        assert.equal(drawingsFileName("my talk"), "my talk-drawings.svg");
    });
});
