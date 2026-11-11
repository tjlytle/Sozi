/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {DRAG_THRESHOLD_PX, SCALE_FACTOR} from "./PlayerController.js";

/** @typedef {import("../protocol/camera.js").CameraMove} CameraMove */

/** The class that keeps the browser's own touch gestures off the deck (src/templates/player.html).
 *
 * @readonly
 * @type {string}
 */
const GESTURES_CLASS = "sozi-preview-gestures";

/**
 * The deck's viewport: where it is in the window, and its size, in pixels.
 *
 * @typedef {object} GestureViewport
 * @property {number} x - Its left edge in the window.
 * @property {number} y - Its top edge in the window.
 * @property {number} width - Its width.
 * @property {number} height - Its height.
 */

/** @typedef {{x: number, y: number}} Point */

/** The pans and zooms the speaker makes on the current-frame preview.
 *
 * A drag past the drag threshold pans, the wheel zooms one step about the pointer, and two
 * pointers pinch. Each gesture is reported as a move in viewport units, which the display
 * makes on its own camera. The click that ends a drag is swallowed before it reaches a link, so
 * only a click that is not a drag follows one.
 */
export class PreviewGestures {
    /** Listen to the gestures on a deck.
     *
     * @param {object} options - What the gestures need.
     * @param {Element} options.root - The deck's SVG root.
     * @param {GestureViewport} options.viewport - The deck's viewport.
     * @param {(move: CameraMove) => void} options.onMove - Called with each move.
     */
    constructor({root, viewport, onMove}) {
        this.root = root;
        this.viewport = viewport;
        this.onMove = onMove;

        /** Where each pointer down on the deck is now, in the viewport's pixels.
         *
         * @type {Map<number, Point>}
         */
        this.pointers = new Map();

        /** Where the single pointer went down, until it has moved past the threshold.
         *
         * @type {?Point}
         */
        this.start = null;

        /** Has the gesture under way panned or pinched, so that its click is not one?
         *
         * @type {boolean}
         */
        this.dragged = false;

        /** The listeners, by event, with whether each listens in the capture phase.
         *
         * @type {[string, (evt: any) => void, boolean][]}
         */
        this.listeners = [
            ["pointerdown", evt => this.down(evt), false],
            ["pointermove", evt => this.move(evt), false],
            ["pointerup", evt => this.up(evt), false],
            ["pointercancel", evt => this.up(evt), false],
            ["wheel", evt => this.wheel(evt), false],
            ["click", evt => this.click(evt), true]
        ];
        for (const [type, listener, capture] of this.listeners) {
            root.addEventListener(type, listener, capture);
        }
        root.classList.add(GESTURES_CLASS);
    }

    /** Where an event happened, in the viewport's pixels.
     *
     * @param {MouseEvent} evt - The event.
     * @returns {Point} The point.
     */
    pointOf(evt) {
        return {x: evt.clientX - this.viewport.x, y: evt.clientY - this.viewport.y};
    }

    /** Report a move, its pixels turned to viewport units.
     *
     * @param {Point} pan - The pan, in pixels.
     * @param {number} zoom - The zoom factor.
     * @param {Point} at - The point the zoom keeps in place, in pixels.
     */
    report(pan, zoom, at) {
        const {width, height} = this.viewport;
        this.onMove({
            x: pan.x / width,
            y: pan.y / height,
            zoom,
            atX: at.x / width,
            atY: at.y / height
        });
    }

    /** A pointer went down: a new gesture starts when it is the first.
     *
     * @param {PointerEvent} evt - The event.
     */
    down(evt) {
        if (this.pointers.size === 0) {
            this.dragged = false;
        }
        const point = this.pointOf(evt);
        this.pointers.set(evt.pointerId, point);
        this.start = this.pointers.size === 1 ? point : null;
    }

    /** A pointer moved: one pans once past the threshold, two pinch.
     *
     * @param {PointerEvent} evt - The event.
     */
    move(evt) {
        const last = this.pointers.get(evt.pointerId);
        if (!last) {
            return;
        }
        const point = this.pointOf(evt);
        if (this.pointers.size === 1) {
            if (this.start) {
                const travel = Math.hypot(point.x - this.start.x, point.y - this.start.y);
                if (travel < DRAG_THRESHOLD_PX) {
                    return;
                }
                this.start = null;
                // Captured once it is a drag only: a captured click would not reach a link.
                this.root.setPointerCapture(evt.pointerId);
            }
            this.dragged = true;
            this.pointers.set(evt.pointerId, point);
            this.report({x: point.x - last.x, y: point.y - last.y}, 1, last);
        } else if (this.pointers.size === 2) {
            this.dragged = true;
            const [a, b] = [...this.pointers.values()];
            this.pointers.set(evt.pointerId, point);
            const [c, d] = [...this.pointers.values()];
            this.pinch(a, b, c, d);
        }
    }

    /** Report a pinch: a zoom about the old middle of two pointers, by how much further apart
     * they are, and a pan by how far their middle moved.
     *
     * @param {Point} a - The first pointer, before.
     * @param {Point} b - The second pointer, before.
     * @param {Point} c - The first pointer, after.
     * @param {Point} d - The second pointer, after.
     */
    pinch(a, b, c, d) {
        const before = Math.hypot(b.x - a.x, b.y - a.y);
        const after = Math.hypot(d.x - c.x, d.y - c.y);
        if (before === 0 || after === 0) {
            return;
        }
        const was = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
        const now = {x: (c.x + d.x) / 2, y: (c.y + d.y) / 2};
        this.report({x: now.x - was.x, y: now.y - was.y}, after / before, was);
    }

    /** A pointer went up, or the browser took it.
     *
     * @param {PointerEvent} evt - The event.
     */
    up(evt) {
        this.pointers.delete(evt.pointerId);
        this.start = null;
    }

    /** The wheel turned: zoom one step about the pointer. Shift turns the display's own wheel
     * into a rotation, which a preview does not make.
     *
     * @param {WheelEvent} evt - The event.
     */
    wheel(evt) {
        evt.preventDefault();
        if (evt.shiftKey || evt.deltaY === 0) {
            return;
        }
        this.report(
            {x: 0, y: 0},
            evt.deltaY < 0 ? SCALE_FACTOR : 1 / SCALE_FACTOR,
            this.pointOf(evt)
        );
    }

    /** Swallow the click that ends a drag, before it reaches a link.
     *
     * @param {MouseEvent} evt - The event.
     */
    click(evt) {
        if (this.dragged) {
            this.dragged = false;
            evt.stopPropagation();
            evt.preventDefault();
        }
    }

    /** Remove every listener and the class. */
    dispose() {
        for (const [type, listener, capture] of this.listeners) {
            this.root.removeEventListener(type, listener, capture);
        }
        this.root.classList.remove(GESTURES_CLASS);
    }
}
