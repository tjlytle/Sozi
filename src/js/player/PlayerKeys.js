/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {isEditableTarget} from "../protocol/editable.js";
import {SCALE_FACTOR, ROTATE_STEP} from "./controlSteps.js";

/** @typedef {import("./PlayerController.js").PlayerController} PlayerController */

/** @typedef {"jumpToFirst" | "jumpToLast" | "jumpToPrevious" | "jumpToNext"} JumpMethod */
/** @typedef {"moveToFirst" | "moveToLast" | "moveToPrevious" | "moveToNext"} MoveMethod */

/** The navigation keys, by key code: the method each one calls with Shift held, and without.
 *
 * @readonly
 * @type {Readonly<Record<number, [JumpMethod, MoveMethod]>>}
 */
const NAVIGATION_KEYS = Object.freeze({
    36: ["jumpToFirst", "moveToFirst"], // Home
    35: ["jumpToLast", "moveToLast"], // End
    38: ["jumpToPrevious", "moveToPrevious"], // Arrow up
    33: ["jumpToPrevious", "moveToPrevious"], // Page up
    37: ["jumpToPrevious", "moveToPrevious"], // Arrow left
    40: ["jumpToNext", "moveToNext"], // Arrow down
    34: ["jumpToNext", "moveToNext"], // Page down
    39: ["jumpToNext", "moveToNext"], // Arrow right
    13: ["jumpToNext", "moveToNext"], // Enter
    32: ["jumpToNext", "moveToNext"] // Space
});

/** The player's keyboard: it turns the keys pressed in the window into the controller's
 * navigation and view actions.
 *
 * Keys typed into a field in the deck (a text input, a text area, a list box or editable
 * content) are left to the field.
 */
export class PlayerKeys {
    /** Listen to the keys pressed in a window.
     *
     * @param {PlayerController} controller - The controller whose actions the keys call.
     * @param {EventTarget} target - Where the keys are pressed: the window, in the player.
     */
    constructor(controller, target) {
        /** The controller whose actions the keys call.
         *
         * @type {PlayerController}
         */
        this.controller = controller;

        /** Where the keys are pressed.
         *
         * @type {EventTarget}
         */
        this.target = target;

        /** The keydown listener, kept to remove it.
         *
         * @param {Event} evt - A DOM event.
         * @returns {void}
         */
        this.keyDownHandler = evt => this.onKeyDown(/** @type {KeyboardEvent} */ (evt));

        /** The keypress listener, kept to remove it.
         *
         * @param {Event} evt - A DOM event.
         * @returns {void}
         */
        this.keyPressHandler = evt => this.onKeyPress(/** @type {KeyboardEvent} */ (evt));

        target.addEventListener("keydown", this.keyDownHandler, false);
        target.addEventListener("keypress", this.keyPressHandler, false);
    }

    /** Stop listening to the keys. */
    dispose() {
        this.target.removeEventListener("keydown", this.keyDownHandler, false);
        this.target.removeEventListener("keypress", this.keyPressHandler, false);
    }

    /** Process a keyboard event.
     *
     * This method handles the navigation keys if they are enabled in the
     * current presentation:
     * Arrows, Page-Up/Down, Home, End, Enter, and Space.
     * With Shift held, a key jumps to its frame without a transition.
     * A navigation key is kept from the browser even when navigation is disabled.
     * A key typed into a field in the deck is left to the field.
     *
     * @param {KeyboardEvent} evt - The DOM event to process.
     *
     * @listens event:keydown
     */
    onKeyDown(evt) {
        // Keys with Alt/Ctrl/Meta modifiers are ignored
        if (evt.altKey || evt.ctrlKey || evt.metaKey || isEditableTarget(evt.target)) {
            return;
        }

        const methods = NAVIGATION_KEYS[evt.keyCode];
        if (!methods) {
            return;
        }
        if (this.controller.presentation.enableKeyboardNavigation) {
            const [jump, move] = methods;
            this.controller[evt.shiftKey ? jump : move]();
        }

        evt.stopPropagation();
        evt.preventDefault();
    }

    /** Process a keyboard event.
     *
     * This method handles character keys: "+", "-", "R", "P", "A", ".", "=".
     * A key typed into a field in the deck is left to the field.
     *
     * @param {KeyboardEvent} evt - The DOM event to process.
     *
     * @listens event:keypress
     */
    onKeyPress(evt) {
        // Keys with modifiers are ignored
        if (evt.altKey || evt.ctrlKey || evt.metaKey || isEditableTarget(evt.target)) {
            return;
        }

        const controller = this.controller;
        const presentation = controller.presentation;
        const viewport = controller.viewport;

        switch (evt.charCode || evt.which) {
            case 43: // +
                if (presentation.enableKeyboardZoom) {
                    controller.zoom(SCALE_FACTOR, viewport.width / 2, viewport.height / 2);
                }
                break;

            case 45: // -
                if (presentation.enableKeyboardZoom) {
                    controller.zoom(1 / SCALE_FACTOR, viewport.width / 2, viewport.height / 2);
                }
                break;

            case 82: // R
                if (presentation.enableKeyboardRotation) {
                    controller.rotate(-ROTATE_STEP);
                }
                break;

            case 114: // r
                if (presentation.enableKeyboardRotation) {
                    controller.rotate(ROTATE_STEP);
                }
                break;

            case 80: // P
            case 112: //p
                controller.togglePause();
                break;

            case 65: // A
            case 97: // a
                controller.viewAll();
                break;

            case 46: // .
                if (presentation.enableKeyboardNavigation) {
                    controller.toggleBlankScreen();
                }
                break;

            case 61: // =
                controller.moveToCurrent();
                break;

            default:
                return;
        }

        evt.stopPropagation();
        evt.preventDefault();
    }
}
