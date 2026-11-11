/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {PlayerControllerEvents} from "./playerControllerEvents.js";
import {DRAG_THRESHOLD_PX, SCALE_FACTOR, ROTATE_STEP} from "./controlSteps.js";

/** @typedef {import("./PlayerController.js").PlayerController} PlayerController */

/** The mouse button for the drag action.
 *
 * 0 is the left button.
 *
 * @readonly
 * @default
 * @type {number}
 */
const DRAG_BUTTON = 0;

/** The delay after the last mouse wheel event to consider that the wheel action is terminated, in milliseconds.
 *
 * @readonly
 * @default
 * @type {number}
 */
const WHEEL_TIMEOUT_MS = 200;

/**
 * Where the pointer is during a drag, as each drag mode reads it.
 *
 * @typedef {object} DragPoint
 * @property {number} x - The pointer's x coordinate in the window, in pixels.
 * @property {number} y - The pointer's y coordinate in the window, in pixels.
 * @property {number} angle - The pointer's angle about the viewport's centre, in degrees.
 * @property {number} distance - The pointer's distance from the viewport's centre, in pixels.
 */

/** The player's mouse: it turns presses, drags, clicks and the wheel on the deck into the
 * controller's navigation and view actions, and signals them through the controller's events.
 */
export class PlayerMouse {
    /** Listen to the mouse on a deck.
     *
     * @param {PlayerController} controller - The controller whose actions the mouse calls.
     * @param {Element} svgRoot - The deck's SVG root.
     */
    constructor(controller, svgRoot) {
        /** The controller whose actions the mouse calls.
         *
         * @type {PlayerController}
         */
        this.controller = controller;

        /** The deck's SVG root.
         *
         * @type {Element}
         */
        this.svgRoot = svgRoot;

        /** The page's root element, where a drag is followed once it has started.
         *
         * @type {Element}
         */
        this.page = /** @type {Document} */ (svgRoot.ownerDocument).documentElement;

        /** Has the mouse moved past the drag threshold since the button was pressed?
         *
         * @type {boolean}
         */
        this.mouseDragged = false;

        /** Has the current drag changed the view?
         *
         * @type {boolean}
         */
        this.mouseDragChangedState = false;

        /** Where the drag started and where the mouse was at the last drag event, in pixels.
         *
         * @type {{startX: number, startY: number, x: number, y: number}}
         */
        this.mouseDrag = {startX: 0, startY: 0, x: 0, y: 0};

        /** The pointer at the start of the drag and at its last step, as the drag modes read it.
         *
         * @type {{start: DragPoint, prev: DragPoint}}
         */
        this.dragPoints = {
            start: {x: 0, y: 0, angle: 0, distance: 0},
            prev: {x: 0, y: 0, angle: 0, distance: 0}
        };

        /** A timeout ID to detect the end of a mouse wheel gesture.
         *
         * @type {?ReturnType<typeof setTimeout>}
         */
        this.wheelTimeout = null;

        /** The listeners on the SVG root, by event type, kept to remove them.
         *
         * @type {Array<[string, (evt: any) => void]>}
         */
        this.rootListeners = [
            ["mousedown", evt => this.onMouseDown(evt)],
            ["mousemove", evt => this.onMouseMove(evt)],
            ["contextmenu", evt => this.onContextMenu(evt)],
            [this.wheelEventName(), evt => this.onWheel(evt)]
        ];

        /** The mouse drag listener, on the page while the button is down.
         *
         * @param {Event} evt - A DOM event.
         * @returns {void}
         */
        this.dragHandler = evt => this.onDrag(/** @type {MouseEvent} */ (evt));

        /** The mouse drag end listener, on the page while the button is down.
         *
         * @param {Event} evt - A DOM event.
         * @returns {void}
         */
        this.dragEndHandler = evt => this.onDragEnd(/** @type {MouseEvent} */ (evt));

        for (const [type, listener] of this.rootListeners) {
            svgRoot.addEventListener(type, listener, false);
        }
    }

    /** Stop listening to the mouse, end a drag in progress and drop a pending wheel signal. */
    dispose() {
        for (const [type, listener] of this.rootListeners) {
            this.svgRoot.removeEventListener(type, listener, false);
        }
        this.stopFollowingDrag();
        if (this.wheelTimeout !== null) {
            clearTimeout(this.wheelTimeout);
            this.wheelTimeout = null;
        }
    }

    /** Process a mouse move event in this viewport.
     *
     * @param {MouseEvent} evt - A DOM event.
     *
     * @listens event:mousemove
     */
    onMouseMove(evt) {
        this.controller.viewport.updateClipCursor(evt.clientX, evt.clientY);
    }

    /** Process a mouse down event in this viewport.
     *
     * If the mouse button pressed is the left button,
     * this method will setup event listeners for detecting a drag action.
     *
     * @param {MouseEvent} evt - A DOM event.
     *
     * @listens event:mousedown
     * @fires module:player/PlayerController.mouseDown
     */
    onMouseDown(evt) {
        evt.stopPropagation();
        evt.preventDefault();

        if (evt.button === DRAG_BUTTON) {
            this.mouseDragged = false;
            this.mouseDragChangedState = false;
            this.mouseDrag = {
                startX: evt.clientX,
                startY: evt.clientY,
                x: evt.clientX,
                y: evt.clientY
            };

            this.page.addEventListener("mousemove", this.dragHandler, false);
            this.page.addEventListener("mouseup", this.dragEndHandler, false);

            this.controller.viewport.updateClipMode(evt.clientX, evt.clientY);
        }

        this.controller.emit(PlayerControllerEvents.mouseDown, evt.button);
    }

    /** Process a mouse drag event.
     *
     * This method is called when a mouse move event happens after a mouse down event.
     * The drag starts once the mouse has moved past the drag threshold; each step then pans,
     * zooms, rotates or clips, by the viewport's drag mode and the modifier keys held.
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

        switch (this.dragModeOf(evt)) {
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

    /** Start a drag at the point the mouse moved past the threshold.
     *
     * @private
     * @param {DragPoint} point - Where the pointer is.
     *
     * @fires module:player/PlayerController.dragStart
     */
    startDrag(point) {
        this.mouseDragged = true;
        this.dragPoints = {start: point, prev: point};

        if (this.controller.presentation.enableMouseTranslation) {
            this.controller.player.pause();
        }

        this.controller.emit(PlayerControllerEvents.dragStart);
    }

    /** The drag mode for a drag step: the viewport's, or with Alt or Shift held while
     * translating, scale or rotate.
     *
     * @private
     * @param {MouseEvent} evt - The drag step.
     * @returns {string} - "translate", "scale", "rotate" or "clip".
     */
    dragModeOf(evt) {
        const mode = this.controller.viewport.dragMode;
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
        this.dragPoints.prev = point;
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
        this.dragPoints.prev = {...point, angle};
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

    /** Pan by the pointer's move since the last drag step.
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
        this.dragPoints.prev = {...point, x, y};
    }

    /** Process a drag end event.
     *
     * This method is called when a mouse up event happens after a mouse down event.
     * If the mouse has been moved past the drag threshold, this method
     * will fire a `dragEnd` event. Otherwise, it will fire a `click` event.
     *
     * @param {MouseEvent} evt - A DOM event
     *
     * @listens event:mouseup
     * @fires module:player/PlayerController.localViewportChange
     * @fires module:player/PlayerController.dragEnd
     * @fires module:player/PlayerController.click
     */
    onDragEnd(evt) {
        evt.stopPropagation();
        evt.preventDefault();

        if (evt.button === DRAG_BUTTON) {
            if (this.mouseDragged) {
                this.controller.emit(PlayerControllerEvents.dragEnd);
                if (this.mouseDragChangedState) {
                    this.controller.emit(PlayerControllerEvents.localViewportChange);
                }
            } else {
                this.onClick(evt);
            }
            this.stopFollowingDrag();
        } else {
            this.onClick(evt);
        }
    }

    /** Remove the drag listeners from the page.
     *
     * @private
     */
    stopFollowingDrag() {
        this.page.removeEventListener("mousemove", this.dragHandler, false);
        this.page.removeEventListener("mouseup", this.dragEndHandler, false);
    }

    /** Move to the next or previous frame on each click event in the viewport.
     *
     * @param {MouseEvent} evt - The mouse click event.
     *
     * @fires module:player/PlayerController.click
     */
    onClick(evt) {
        const controller = this.controller;
        if (!controller.editMode && controller.presentation.enableMouseNavigation) {
            switch (evt.button) {
                case 0:
                    controller.moveToNext();
                    break;
                case 2:
                    controller.moveToPrevious();
                    break;
            }
        }
        controller.emit(PlayerControllerEvents.click, evt);
    }

    /** Process a mouse wheel event in this viewport.
     *
     * The effect of the mouse wheel depends on the state of the Shift key:
     *    - released: zoom in and out,
     *    - pressed: rotate clockwise or counter-clockwise
     *
     * @param {WheelEvent} evt - A DOM event.
     *
     * @listens event:wheel
     * @fires module:player/PlayerController.localViewportChange
     */
    onWheel(evt) {
        if (this.wheelTimeout !== null) {
            clearTimeout(this.wheelTimeout);
        }

        evt.stopPropagation();
        evt.preventDefault();

        const controller = this.controller;
        const delta = this.wheelDelta(evt);
        let changed = false;

        if (delta !== 0) {
            if (evt.shiftKey) {
                // TODO rotate around mouse cursor
                if (controller.editMode || controller.presentation.enableMouseRotation) {
                    controller.rotate(delta > 0 ? ROTATE_STEP : -ROTATE_STEP);
                    changed = true;
                }
            } else {
                if (controller.editMode || controller.presentation.enableMouseZoom) {
                    controller.zoom(
                        delta > 0 ? SCALE_FACTOR : 1 / SCALE_FACTOR,
                        evt.clientX - controller.viewport.x,
                        evt.clientY - controller.viewport.y
                    );
                    changed = true;
                }
            }
        }

        if (changed) {
            this.wheelTimeout = setTimeout(() => {
                this.wheelTimeout = null;
                controller.emit(PlayerControllerEvents.localViewportChange);
            }, WHEEL_TIMEOUT_MS);
        }
    }

    /** Process a right-click in the associated viewport.
     *
     * This method forwards the `contextmenu` event as a click.
     *
     * @param {MouseEvent} evt - A DOM event.
     *
     * @listens event:contextmenu
     * @fires module:player/PlayerController.click
     */
    onContextMenu(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        this.onClick(evt);
    }

    /** The name of the wheel event the browser showing the deck sends.
     *
     * @private
     * @returns {string} - "wheel", or a legacy name in an old browser.
     */
    wheelEventName() {
        const doc = /** @type {any} */ (this.svgRoot.ownerDocument);
        return "onwheel" in doc.createElement("div")
            ? "wheel" // Modern browsers support "wheel"
            : doc.onmousewheel !== undefined
              ? "mousewheel" // Webkit and IE support at least "mousewheel"
              : "DOMMouseScroll"; // Firefox < 17
    }

    /** How far a wheel event turns the wheel, positive away from the person.
     *
     * @private
     * @param {any} evt - A "wheel", "mousewheel" or "DOMMouseScroll" event.
     * @returns {number} - The signed amount.
     */
    wheelDelta(evt) {
        if (evt.wheelDelta) {
            // "mousewheel" event
            return evt.wheelDelta;
        }
        if (evt.detail) {
            // "DOMMouseScroll" event
            return -evt.detail;
        }
        // "wheel" event
        return -evt.deltaY;
    }
}
