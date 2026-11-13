/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EMPTY_DRAWINGS} from "../protocol/drawings.js";
import {applyDrawing} from "../protocol/strokes.js";

/** @typedef {import("../protocol/drawings.js").Drawings} Drawings */
/** @typedef {import("../protocol/drawings.js").DrawingCommand} DrawingCommand */
/** @typedef {import("../protocol/messages.js").Message} Message */

/** The current preview's pen: what it draws with comes from the presenter.
 *
 * @typedef {{setTool: (tool: import("../protocol/drawings.js").DrawingTool) => void}} Pen
 */

/**
 * What the drawings are painted on and reported through.
 *
 * @typedef {object} DisplayDrawingsOptions
 * @property {{render: (drawings: Drawings) => void}} drawingLayer - Paints the drawings on the
 *   deck.
 * @property {() => boolean} isPreview - Is the deck a presenter preview now?
 * @property {(message: Message) => void} report - Sends a message about the display; a preview
 *   sends nothing.
 */

/** The drawings on the deck and the current preview's pen, which the display holds for the
 * session.
 *
 * It applies each drawing command, paints the result and reports the command; a preview takes
 * whole drawings from its presenter instead, and hands each drawing tool to its pen.
 */
export class DisplayDrawings {
    /** Start with no drawings and no pen.
     *
     * @param {DisplayDrawingsOptions} options - The layer, the preview test and the report.
     */
    constructor({drawingLayer, isPreview, report}) {
        this.drawingLayer = drawingLayer;
        this.isPreview = isPreview;
        this.report = report;

        /** The drawings as they are now.
         *
         * @type {Drawings}
         */
        this.drawings = EMPTY_DRAWINGS;

        /** The pen of the current preview; null in another deck.
         *
         * @type {?Pen}
         */
        this.pen = null;
    }

    /** The drawings as they are now.
     *
     * @readonly
     * @type {Drawings}
     */
    get current() {
        return this.drawings;
    }

    /** Carry out a drawing command: paint the drawings after it and report it. A command that
     * changes nothing is not reported.
     *
     * @param {DrawingCommand} command - The command.
     */
    draw(command) {
        const drawings = applyDrawing(this.drawings, command);
        if (drawings !== this.drawings) {
            this.drawings = drawings;
            this.drawingLayer.render(drawings);
            this.report(command);
        }
    }

    /** Hold and paint drawings from the presenter, in a preview only.
     *
     * @param {Drawings} drawings - The drawings.
     */
    replace(drawings) {
        if (this.isPreview()) {
            this.drawings = drawings;
            this.drawingLayer.render(drawings);
        }
    }

    /** Keep the pen the current preview draws with.
     *
     * @param {?Pen} pen - The pen; null in another deck.
     */
    usePen(pen) {
        this.pen = pen;
    }

    /** Hand a drawing tool to the pen, if there is one.
     *
     * @param {import("../protocol/drawings.js").DrawingTool} tool - The tool.
     */
    setTool(tool) {
        if (this.pen) {
            this.pen.setTool(tool);
        }
    }
}
