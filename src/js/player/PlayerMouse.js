/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {PlayerControllerEvents} from "./playerControllerEvents.js";
import {SCALE_FACTOR, ROTATE_STEP} from "./controlSteps.js";
import {PlayerDrag, DRAG_BUTTON} from "./PlayerDrag.js";

/** @typedef {import("./PlayerController.js").PlayerController} PlayerController */

/** The delay after the last mouse wheel event to consider that the wheel action is terminated, in milliseconds.
 *
 * @readonly
 * @default
 * @type {number}
 */
const WHEEL_TIMEOUT_MS = 200;

/** The player's mouse: it turns presses, clicks and the wheel on the deck into the
 * controller's navigation and view actions, and signals them through the controller's events.
 * Each press of the drag button starts a `PlayerDrag`, which follows the mouse until the release.
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

        /** The drag of the last press of the drag button, if any.
         *
         * @type {?PlayerDrag}
         */
        this.drag = null;

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
            [
                wheelEventOf(/** @type {Document} */ (svgRoot.ownerDocument)),
                evt => this.onWheel(evt)
            ]
        ];

        for (const [type, listener] of this.rootListeners) {
            svgRoot.addEventListener(type, listener, false);
        }
    }

    /** Stop listening to the mouse, end a drag in progress and drop a pending wheel signal. */
    dispose() {
        for (const [type, listener] of this.rootListeners) {
            this.svgRoot.removeEventListener(type, listener, false);
        }
        if (this.drag) {
            this.drag.dispose();
            this.drag = null;
        }
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
     * A press of the drag button starts a drag, which replaces the drag of an earlier press.
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
            if (this.drag) {
                this.drag.dispose();
            }
            const page = /** @type {Document} */ (this.svgRoot.ownerDocument).documentElement;
            this.drag = new PlayerDrag(this.controller, page, evt, click => this.onClick(click));
            this.controller.viewport.updateClipMode(evt.clientX, evt.clientY);
        }

        this.controller.emit(PlayerControllerEvents.mouseDown, evt.button);
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
        const delta = wheelDeltaOf(evt);
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
}

/** The name of the wheel event a browser sends.
 *
 * @param {Document} doc - The document showing the deck.
 * @returns {string} - "wheel", or a legacy name in an old browser.
 */
function wheelEventOf(doc) {
    return "onwheel" in doc.createElement("div")
        ? "wheel" // Modern browsers support "wheel"
        : /** @type {any} */ (doc).onmousewheel !== undefined
          ? "mousewheel" // Webkit and IE support at least "mousewheel"
          : "DOMMouseScroll"; // Firefox < 17
}

/** How far a wheel event turns the wheel, positive away from the person.
 *
 * @param {any} evt - A "wheel", "mousewheel" or "DOMMouseScroll" event.
 * @returns {number} - The signed amount.
 */
function wheelDeltaOf(evt) {
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
