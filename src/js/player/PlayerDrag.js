/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {PlayerControllerEvents} from "./playerControllerEvents.js";
import {DRAG_THRESHOLD_PX} from "./controlSteps.js";

/** @typedef {import("./PlayerController.js").PlayerController} PlayerController */

/** The mouse button for the drag action.
 *
 * 0 is the left button.
 *
 * @readonly
 * @default
 * @type {number}
 */
export const DRAG_BUTTON = 0;

/**
 * Where the pointer is during a drag, as each drag mode reads it.
 *
 * @typedef {object} DragPoint
 * @property {number} x - The pointer's x coordinate in the window, in pixels.
 * @property {number} y - The pointer's y coordinate in the window, in pixels.
 * @property {number} angle - The pointer's angle about the viewport's centre, in degrees.
 * @property {number} distance - The pointer's distance from the viewport's centre, in pixels.
 */

/** One press of the drag button on the deck, followed on the page until its release.
 *
 * The drag starts once the mouse has moved past the drag threshold; each step then pans,
 * zooms, rotates or clips, by the viewport's drag mode and the modifier keys held. A release
 * before the threshold is a click.
 */
export class PlayerDrag {
    /** Follow the mouse on the page from a press of the drag button.
     *
     * @param {PlayerController} controller - The controller whose actions the drag calls.
     * @param {EventTarget} page - Where the mouse is followed: the page's root element.
     * @param {MouseEvent} press - The press of the drag button on the deck.
     * @param {(evt: MouseEvent) => void} onClick - Called with a release that is a click.
     */
    constructor(controller, page, press, onClick) {
        /** The controller whose actions the drag calls.
         *
         * @type {PlayerController}
         */
        this.controller = controller;

        /** Where the mouse is followed.
         *
         * @type {EventTarget}
         */
        this.page = page;

        /** Called with a release that is a click.
         *
         * @type {(evt: MouseEvent) => void}
         */
        this.onClick = onClick;

        /** Has the mouse moved past the drag threshold since the press?
         *
         * @type {boolean}
         */
        this.mouseDragged = false;

        /** Has the drag changed the view?
         *
         * @type {boolean}
         */
        this.mouseDragChangedState = false;

        /** Where the press was and where the mouse was at the last drag event, in pixels.
         *
         * @type {{startX: number, startY: number, x: number, y: number}}
         */
        this.mouseDrag = {
            startX: press.clientX,
            startY: press.clientY,
            x: press.clientX,
            y: press.clientY
        };

        /** The pointer at the start of the drag, and at the last step of each mode. A step
         * updates only its own mode's fields of `prev`, so after a change of modifier keys
         * each mode counts from its own last step.
         *
         * @type {{start: DragPoint, prev: DragPoint}}
         */
        this.dragPoints = {
            start: {x: 0, y: 0, angle: 0, distance: 0},
            prev: {x: 0, y: 0, angle: 0, distance: 0}
        };

        /** The mouse move listener, kept to remove it.
         *
         * @param {Event} evt - A DOM event.
         * @returns {void}
         */
        this.dragHandler = evt => this.onDrag(/** @type {MouseEvent} */ (evt));

        /** The mouse up listener, kept to remove it.
         *
         * @param {Event} evt - A DOM event.
         * @returns {void}
         */
        this.dragEndHandler = evt => this.onDragEnd(/** @type {MouseEvent} */ (evt));

        page.addEventListener("mousemove", this.dragHandler, false);
        page.addEventListener("mouseup", this.dragEndHandler, false);
    }

    /** Stop following the mouse. */
    dispose() {
        this.page.removeEventListener("mousemove", this.dragHandler, false);
        this.page.removeEventListener("mouseup", this.dragEndHandler, false);
    }

    /** Process a mouse move on the page after the press.
     *
     * @param {MouseEvent} evt - A DOM event.
     *
     * @listens event:mousemove
     * @fires module:player/PlayerController.dragStart
     */
    onDrag(evt) {
        evt.stopPropagation();
        const viewport = this.controller.viewport;
        const xFromCenter = evt.clientX - viewport.x - viewport.width / 2;
        const yFromCenter = evt.clientY - viewport.y - viewport.height / 2;
        /** @type {DragPoint} */
        const point = {
            x: evt.clientX,
            y: evt.clientY,
            angle: (180 * Math.atan2(yFromCenter, xFromCenter)) / Math.PI,
            distance: Math.sqrt(xFromCenter * xFromCenter + yFromCenter * yFromCenter)
        };
        const deltaX = evt.clientX - this.mouseDrag.x;
        const deltaY = evt.clientY - this.mouseDrag.y;

        // The drag action is confirmed when one of the mouse coordinates
        // has moved past the threshold
        if (
            !this.mouseDragged &&
            (Math.abs(deltaX) > DRAG_THRESHOLD_PX || Math.abs(deltaY) > DRAG_THRESHOLD_PX)
        ) {
            this.startDrag(point);
        }
        if (!this.mouseDragged) {
            return;
        }

        switch (dragModeOf(viewport.dragMode, evt)) {
            case "scale":
                this.dragScale(point);
                break;
            case "rotate":
                this.dragRotate(point, evt.ctrlKey);
                break;
            case "clip":
                this.dragClip(deltaX, deltaY);
                break;
            default: // case "translate":
                this.dragTranslate(point, evt.ctrlKey);
        }
        this.mouseDrag.x = evt.clientX;
        this.mouseDrag.y = evt.clientY;
    }

    /** Process the release of a mouse button on the page.
     *
     * The release of the drag button ends the drag: it fires `dragEnd` if the mouse moved past
     * the drag threshold, and is a click otherwise. The release of another button is a click.
     *
     * @param {MouseEvent} evt - A DOM event
     *
     * @listens event:mouseup
     * @fires module:player/PlayerController.localViewportChange
     * @fires module:player/PlayerController.dragEnd
     */
    onDragEnd(evt) {
        evt.stopPropagation();
        evt.preventDefault();

        if (evt.button !== DRAG_BUTTON) {
            this.onClick(evt);
            return;
        }
        if (this.mouseDragged) {
            this.controller.emit(PlayerControllerEvents.dragEnd);
            if (this.mouseDragChangedState) {
                this.controller.emit(PlayerControllerEvents.localViewportChange);
            }
        } else {
            this.onClick(evt);
        }
        this.dispose();
    }

    /** Start the drag at the point the mouse moved past the threshold.
     *
     * @private
     * @param {DragPoint} point - Where the pointer is.
     *
     * @fires module:player/PlayerController.dragStart
     */
    startDrag(point) {
        this.mouseDragged = true;
        this.dragPoints = {start: point, prev: {...point}};

        if (this.controller.presentation.enableMouseTranslation) {
            this.controller.player.pause();
        }

        this.controller.emit(PlayerControllerEvents.dragStart);
    }

    /** Zoom about the viewport's centre by the change in the pointer's distance from it.
     *
     * @private
     * @param {DragPoint} point - Where the pointer is.
     */
    dragScale(point) {
        const controller = this.controller;
        if (!controller.editMode && !controller.presentation.enableMouseZoom) {
            return;
        }
        const prev = this.dragPoints.prev.distance;
        if (prev !== 0) {
            controller.zoom(
                point.distance / prev,
                controller.viewport.width / 2,
                controller.viewport.height / 2
            );
            this.mouseDragChangedState = true;
        }
        this.dragPoints.prev.distance = point.distance;
    }

    /** Rotate by the angle the pointer swept about the viewport's centre.
     *
     * @private
     * @param {DragPoint} point - Where the pointer is.
     * @param {boolean} snap - Ctrl is held: turn in steps of ten degrees from the start.
     */
    dragRotate(point, snap) {
        const controller = this.controller;
        if (!controller.editMode && !controller.presentation.enableMouseRotation) {
            return;
        }
        const start = this.dragPoints.start.angle;
        const angle = snap ? 10 * Math.round((point.angle - start) / 10) + start : point.angle;
        controller.rotate(this.dragPoints.prev.angle - angle);
        this.mouseDragChangedState = true;
        this.dragPoints.prev.angle = angle;
    }

    /** Resize the clip rectangle in the editor.
     *
     * @private
     * @param {number} deltaX - The horizontal move since the last drag step, in pixels.
     * @param {number} deltaY - The vertical move since the last drag step, in pixels.
     */
    dragClip(deltaX, deltaY) {
        const viewport = this.controller.viewport;
        viewport.clipByMode(
            this.mouseDrag.startX - viewport.x,
            this.mouseDrag.startY - viewport.y,
            this.mouseDrag.x - viewport.x,
            this.mouseDrag.y - viewport.y,
            deltaX,
            deltaY
        );
        this.mouseDragChangedState = true;
    }

    /** Pan by the pointer's move since the last pan step.
     *
     * @private
     * @param {DragPoint} point - Where the pointer is.
     * @param {boolean} lock - Ctrl is held: pan only along the axis the drag has moved most.
     */
    dragTranslate(point, lock) {
        const controller = this.controller;
        if (!controller.editMode && !controller.presentation.enableMouseTranslation) {
            return;
        }
        const start = this.dragPoints.start;
        let x = point.x;
        let y = point.y;
        if (lock) {
            if (Math.abs(x - start.x) >= Math.abs(y - start.y)) {
                y = start.y;
            } else {
                x = start.x;
            }
        }
        const prev = this.dragPoints.prev;
        controller.translate(x - prev.x, y - prev.y);
        this.mouseDragChangedState = true;
        prev.x = x;
        prev.y = y;
    }
}

/** The drag mode for a drag step: the viewport's, or with Alt or Shift held while
 * translating, scale or rotate.
 *
 * @param {string} mode - The viewport's drag mode.
 * @param {MouseEvent} evt - The drag step.
 * @returns {string} - "translate", "scale", "rotate" or "clip".
 */
function dragModeOf(mode, evt) {
    if (mode === "translate") {
        if (evt.altKey) {
            return "scale";
        }
        if (evt.shiftKey) {
            return "rotate";
        }
    }
    return mode;
}
