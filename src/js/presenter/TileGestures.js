/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {frameOfTarget} from "./framePicker.js";

/** How long a touch is held to be a long press, in milliseconds.
 *
 * @readonly
 * @default
 * @type {number}
 */
const LONG_PRESS_MS = 500;

/** Works out from the pointer and the focus which frame's notes the Frames panel shows.
 *
 * A long press outranks a mouse over a tile, and that outranks the focus. A finger has no
 * hover, so its notes last until the next press.
 */
export class TileGestures {
    /** Listen to a grid of tiles.
     *
     * @param {HTMLElement} grid - The element holding the tiles.
     * @param {Pick<Window, "setTimeout" | "clearTimeout">} host - The window, for the timer.
     * @param {(index: ?number) => void} onNotes - Called with the frame whose notes to show,
     *   null for none.
     */
    constructor(grid, host, onNotes) {
        this.host = host;
        this.onNotes = onNotes;

        /** The frame each gesture asks the notes of, null for none.
         *
         * @type {{press: ?number, hover: ?number, focus: ?number}}
         */
        this.asked = {press: null, hover: null, focus: null};

        /** The timer of a touch being held, null when there is none.
         *
         * @type {?number}
         */
        this.pressTimer = null;

        /** Was the last press a long one, so that the click it may end in is not a jump?
         *
         * @type {boolean}
         */
        this.longPressed = false;

        /** Removes every listener on the grid. */
        this.listeners = new AbortController();

        const {signal} = this.listeners;
        const on = (type, listener) => grid.addEventListener(type, listener, {signal});
        on("pointerdown", evt => this.startPress(evt));
        for (const type of ["pointerup", "pointercancel", "scroll"]) {
            on(type, () => this.cancelPress());
        }
        on("pointerover", evt => this.hover(evt, evt.target));
        on("pointerout", evt => this.hover(evt, evt.relatedTarget));
        on("focusin", evt => this.ask("focus", frameOfTarget(evt.target)));
        on("focusout", () => this.ask("focus", null));
        on("contextmenu", evt => {
            // A held touch opens the browser's menu just when the notes should show.
            if (this.pressTimer !== null || this.longPressed) {
                evt.preventDefault();
            }
        });
    }

    /** Start timing a touch; any press ends the notes of the last long one.
     *
     * @param {PointerEvent} evt - The event.
     */
    startPress(evt) {
        this.cancelPress();
        this.longPressed = false;
        if (this.asked.press !== null) {
            this.ask("press", null);
        }
        const index = frameOfTarget(evt.target);
        if (evt.pointerType === "touch" && index !== null) {
            this.pressTimer = this.host.setTimeout(() => {
                this.pressTimer = null;
                this.longPressed = true;
                this.ask("press", index);
            }, LONG_PRESS_MS);
        }
    }

    /** Stop timing a touch: it ended, or it became a scroll. */
    cancelPress() {
        if (this.pressTimer !== null) {
            this.host.clearTimeout(this.pressTimer);
            this.pressTimer = null;
        }
    }

    /** A mouse has moved: it is over the tile of this target, if any.
     *
     * @param {PointerEvent} evt - The event.
     * @param {EventTarget | null} target - What the mouse is over now.
     */
    hover(evt, target) {
        if (evt.pointerType !== "touch") {
            this.ask("hover", frameOfTarget(target));
        }
    }

    /** Take what a gesture asks for, and report what that leaves.
     *
     * @param {"press" | "hover" | "focus"} gesture - The gesture.
     * @param {?number} frame - The frame's position, null for none.
     */
    ask(gesture, frame) {
        this.asked[gesture] = frame;
        const {press, hover, focus} = this.asked;
        // A frame at position 0 asks too, so not `||`.
        const [index] = [press, hover, focus].filter(asked => asked !== null);
        this.onNotes(index === undefined ? null : index);
    }

    /** Stop the timer and every listener. */
    dispose() {
        this.cancelPress();
        this.listeners.abort();
    }
}
