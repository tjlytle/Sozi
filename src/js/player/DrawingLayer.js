/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {Tools} from "../protocol/drawings.js";
import {strokeOutline} from "../protocol/strokeOutline.js";

/** @typedef {import("../protocol/drawings.js").Drawings} Drawings */
/** @typedef {import("../protocol/drawings.js").Stroke} Stroke */

/** The SVG namespace. */
const SVG_NS = "http://www.w3.org/2000/svg";

/** The layer of the deck the drawings are painted in, above the artwork.
 *
 * It holds one filled path per stroke: the highlighters in a group under the pens, so a
 * highlight never hides a line. It takes the transform of the bottom layer's camera on every
 * update of that camera, so a stroke stays on the artwork it marks. It lets the pointer
 * through, so a link under a stroke still works. Its look is in `src/templates/player.html`.
 */
export class DrawingLayer {
    /** Add the layer, empty, as the last child of the deck's SVG.
     *
     * @param {SVGSVGElement} svgRoot - The deck's SVG.
     */
    constructor(svgRoot) {
        const doc = svgRoot.ownerDocument;

        /** The layer's group.
         *
         * @type {SVGGElement}
         */
        this.group = doc.createElementNS(SVG_NS, "g");
        this.group.classList.add("sozi-drawing");

        /** The group of each tool, the highlighter's first so it is painted under the pen's.
         *
         * @type {Record<string, SVGGElement>}
         */
        this.toolGroups = {};
        for (const tool of [Tools.highlighter, Tools.pen]) {
            const toolGroup = doc.createElementNS(SVG_NS, "g");
            toolGroup.classList.add(`sozi-drawing__${tool}`);
            this.toolGroups[tool] = toolGroup;
            this.group.append(toolGroup);
        }
        svgRoot.append(this.group);

        /** The path drawn for each stroke, by id, with the stroke it was drawn from.
         *
         * @type {Map<string, {stroke: Stroke, path: SVGPathElement}>}
         */
        this.paths = new Map();
    }

    /** Show the drawings, redrawing only the strokes that changed.
     *
     * @param {Drawings} drawings - The drawings.
     */
    render({visible, strokes}) {
        this.group.classList.toggle("sozi-drawing--hidden", !visible);
        const ids = new Set(strokes.map(stroke => stroke.id));
        for (const [id, {path}] of this.paths) {
            if (!ids.has(id)) {
                path.remove();
                this.paths.delete(id);
            }
        }
        for (const stroke of strokes) {
            const drawn = this.paths.get(stroke.id);
            if (!drawn) {
                const path = this.group.ownerDocument.createElementNS(SVG_NS, "path");
                // The protocol lets through only a #rrggbb colour (protocol/drawings.js).
                path.setAttribute("fill", stroke.color);
                path.setAttribute("d", strokeOutline(stroke));
                this.toolGroups[stroke.tool].append(path);
                this.paths.set(stroke.id, {stroke, path});
            } else if (drawn.stroke !== stroke) {
                drawn.path.setAttribute("d", strokeOutline(stroke));
                drawn.stroke = stroke;
            }
        }
    }

    /** Move the layer as a camera moves its layer.
     *
     * @param {any} camera - The bottom layer's camera, after its update.
     */
    follow(camera) {
        const [layerGroup] = camera.svgTransformGroups;
        const transform = layerGroup && layerGroup.getAttribute("transform");
        if (transform) {
            this.group.setAttribute("transform", transform);
        }
    }

    /** Remove the layer from the deck. */
    dispose() {
        this.group.remove();
        this.paths.clear();
    }
}
