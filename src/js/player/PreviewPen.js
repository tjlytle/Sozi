/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {
    MAX_POINTS_PER_MESSAGE,
    PenTools,
    strokeBeginMessage,
    strokeEndMessage,
    strokeEraseMessage,
    strokePointsMessage
} from "../protocol/drawings.js";
import {strokesNear} from "../protocol/strokes.js";

/** @typedef {import("../protocol/drawings.js").Drawings} Drawings */
/** @typedef {import("../protocol/drawings.js").DrawingTool} DrawingTool */
/** @typedef {import("../protocol/drawings.js").DrawingCommand} DrawingCommand */
/** @typedef {import("../protocol/drawings.js").Point} Point */

/** How near the eraser must pass to a stroke, in the preview's pixels.
 *
 * @readonly
 * @type {number}
 */
const ERASER_TOLERANCE_PX = 8;

/** The pressure of a pointer that reports none: some touch screens report 0, which would draw
 * nothing.
 *
 * @readonly
 * @type {number}
 */
const DEFAULT_PRESSURE = 0.5;

/** What the pen draws with until the presenter says otherwise: a thin red pen, in pan mode.
 *
 * @readonly
 * @type {DrawingTool}
 */
const DEFAULT_TOOL = Object.freeze({
    draw: false,
    tool: PenTools.pen,
    color: "#e53935",
    width: 0.004
});

/** The speaker's pen on the current-frame preview.
 *
 * A stylus always draws; a mouse or a finger draws in draw mode only, and otherwise reaches the
 * preview's gestures, which pan. A drawing pointer is captured and its events go no further, so
 * neither the gestures nor a link see them; one pointer draws at a time. Each point is turned
 * into canvas units through the drawing layer's screen matrix, and reported as stroke commands,
 * which the presenter sends to the display. The eraser reports each stroke it passes over.
 */
export class PreviewPen {
    /** Listen for the pen on a deck.
     *
     * @param {object} options - What the pen needs.
     * @param {Element} options.root - The deck's SVG root.
     * @param {SVGGraphicsElement} options.layer - The drawing layer's group: its user units are
     *   the canvas units.
     * @param {{width: number, height: number}} options.viewport - The deck's viewport, in pixels.
     * @param {(command: DrawingCommand) => void} options.onDrawing - Called with each command.
     * @param {() => Drawings} options.drawings - The drawings the preview shows, for the eraser.
     */
    constructor({root, layer, viewport, onDrawing, drawings}) {
        this.root = root;
        this.layer = layer;
        this.viewport = viewport;
        this.onDrawing = onDrawing;
        this.drawings = drawings;

        /** What the pen draws with.
         *
         * @type {DrawingTool}
         */
        this.tool = DEFAULT_TOOL;

        /** The pointer drawing now, or null.
         *
         * @type {?number}
         */
        this.pointerId = null;

        /** The id of the stroke being drawn, or null while erasing or idle.
         *
         * @type {?string}
         */
        this.strokeId = null;

        /** The strokes the eraser has reported in this pass.
         *
         * @type {Set<string>}
         */
        this.erased = new Set();

        /** Has a pointer drawn since the last click, so that the click is swallowed?
         *
         * @type {boolean}
         */
        this.drew = false;

        /** How many strokes the pen has begun, for their ids.
         *
         * @type {number}
         */
        this.count = 0;

        /** A prefix for this pen's stroke ids: `crypto.randomUUID` may be missing on `file://`.
         *
         * @type {string}
         */
        this.prefix = `p-${Math.random().toString(36).slice(2, 10)}`;

        /** The listeners, by event, all in the capture phase.
         *
         * @type {[string, (evt: any) => void][]}
         */
        this.listeners = [
            ["pointerdown", evt => this.down(evt)],
            ["pointermove", evt => this.move(evt)],
            ["pointerup", evt => this.up(evt)],
            ["pointercancel", evt => this.up(evt)],
            ["click", evt => this.click(evt)]
        ];
        for (const [type, listener] of this.listeners) {
            root.addEventListener(type, listener, true);
        }
    }

    /** Take what the presenter says the pen draws with.
     *
     * @param {DrawingTool} tool - The tool.
     */
    setTool({draw, tool, color, width}) {
        this.tool = {draw, tool, color, width};
    }

    /** Keep an event of a drawing pointer from the gestures, the links and the focus.
     *
     * @param {Event} evt - The event.
     */
    stop(evt) {
        evt.stopImmediatePropagation();
        evt.preventDefault();
    }

    /** The screen matrix's inverse: client pixels to canvas units.
     *
     * @returns {DOMMatrix} The matrix.
     */
    toCanvas() {
        // Cast: the drawing layer is in a rendered deck, so it has a screen matrix.
        return /** @type {DOMMatrix} */ (this.layer.getScreenCTM()).inverse();
    }

    /** The points of an event, one for each event the browser coalesced into it.
     *
     * @param {PointerEvent} evt - The event.
     * @param {DOMMatrix} m - Client pixels to canvas units.
     * @returns {Point[]} The points, in canvas units.
     */
    pointsOf(evt, m) {
        const coalesced = evt.getCoalescedEvents ? evt.getCoalescedEvents() : [];
        const events = coalesced.length ? coalesced : [evt];
        return events
            .slice(0, MAX_POINTS_PER_MESSAGE)
            .map(({clientX, clientY, pressure}) => [
                m.a * clientX + m.c * clientY + m.e,
                m.b * clientX + m.d * clientY + m.f,
                pressure > 0 ? Math.min(1, pressure) : DEFAULT_PRESSURE
            ]);
    }

    /** A pointer went down: a stylus, or any pointer in draw mode, starts to draw.
     *
     * @param {PointerEvent} evt - The event.
     */
    down(evt) {
        if (this.pointerId !== null) {
            return;
        }
        // A stroke ends without a click when the pointer is a finger or a stylus.
        this.drew = false;
        const draws = evt.pointerType === "pen" || this.tool.draw;
        if (!draws || evt.button !== 0) {
            return;
        }
        this.stop(evt);
        this.pointerId = evt.pointerId;
        this.drew = true;
        this.root.setPointerCapture(evt.pointerId);
        const m = this.toCanvas();
        const points = this.pointsOf(evt, m);
        if (this.tool.tool === PenTools.eraser) {
            this.erased = new Set();
            this.erase(points, m);
            return;
        }
        // Canvas units per pixel: the matrix's scale.
        const scale = Math.hypot(m.a, m.b);
        const side = Math.min(this.viewport.width, this.viewport.height);
        this.count++;
        this.strokeId = `${this.prefix}-${this.count}`;
        const {tool, color, width} = this.tool;
        this.onDrawing(
            strokeBeginMessage({
                id: this.strokeId,
                tool,
                color,
                width: width * side * scale,
                points
            })
        );
    }

    /** The drawing pointer moved: add its points, or erase under them.
     *
     * @param {PointerEvent} evt - The event.
     */
    move(evt) {
        if (evt.pointerId !== this.pointerId) {
            return;
        }
        this.stop(evt);
        const m = this.toCanvas();
        const points = this.pointsOf(evt, m);
        if (this.strokeId === null) {
            this.erase(points, m);
        } else {
            this.onDrawing(strokePointsMessage(this.strokeId, points));
        }
    }

    /** The drawing pointer went up, or the browser took it: the stroke ends.
     *
     * @param {PointerEvent} evt - The event.
     */
    up(evt) {
        if (evt.pointerId !== this.pointerId) {
            return;
        }
        this.stop(evt);
        if (this.strokeId !== null) {
            this.onDrawing(strokeEndMessage(this.strokeId));
        }
        this.pointerId = null;
        this.strokeId = null;
    }

    /** Report each stroke the eraser passes over, once a pass. Hidden drawings are not erased.
     *
     * @param {Point[]} points - Where the eraser is, in canvas units.
     * @param {DOMMatrix} m - Client pixels to canvas units.
     */
    erase(points, m) {
        const drawings = this.drawings();
        if (!drawings.visible) {
            return;
        }
        const tolerance = ERASER_TOLERANCE_PX * Math.hypot(m.a, m.b);
        for (const point of points) {
            for (const id of strokesNear(drawings, point, tolerance)) {
                if (!this.erased.has(id)) {
                    this.erased.add(id);
                    this.onDrawing(strokeEraseMessage(id));
                }
            }
        }
    }

    /** Swallow the click that ends a stroke, before it reaches a link.
     *
     * @param {MouseEvent} evt - The event.
     */
    click(evt) {
        if (this.drew) {
            this.drew = false;
            evt.stopImmediatePropagation();
            evt.preventDefault();
        }
    }

    /** Remove every listener. */
    dispose() {
        for (const [type, listener] of this.listeners) {
            this.root.removeEventListener(type, listener, true);
        }
    }
}
