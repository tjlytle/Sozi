/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {PlayerControllerEvents} from "./PlayerController.js";
import {ON_FRAME, cameraMessage, composeView} from "../protocol/camera.js";

/** @typedef {import("../protocol/messages.js").Message} Message */
/** @typedef {import("../protocol/camera.js").CameraView} CameraView */

/**
 * What a camera tracker is built from.
 *
 * @typedef {object} CameraTrackerOptions
 * @property {any} controller - The deck's player controller.
 * @property {(message: Message) => void} report - Called with a `camera` message each time the
 *   view changes.
 */

/** Give a tracker a new view, and report it when it is not the one there was.
 *
 * @param {CameraTracker} tracker - The tracker.
 * @param {CameraView} view - The view.
 */
function setView(tracker, view) {
    const was = tracker.current;
    tracker.current = view;
    const same = ["offFrame", "zoom", "x", "y"].every(key => view[key] === was[key]);
    if (!same) {
        tracker.report(cameraMessage(view));
    }
}

/** Where the display's camera looks, relative to the current frame.
 *
 * It folds every zoom, pan and rotation of the controller into the view and reports it: the
 * moves a surface asks for and those of the display's own mouse go the same way.
 */
export class CameraTracker {
    /** Start following a controller's moves.
     *
     * @param {CameraTrackerOptions} options - The controller and where to report.
     */
    constructor({controller, report}) {
        this.controller = controller;
        this.report = report;

        /** The view as it is now: read it through `view`.
         *
         * @type {CameraView}
         */
        this.current = ON_FRAME;

        const {viewport} = controller;
        this.onZoom = ({factor, x, y}) =>
            setView(
                this,
                composeView(this.view, {
                    x: 0,
                    y: 0,
                    zoom: factor,
                    atX: x / viewport.width,
                    atY: y / viewport.height
                })
            );
        this.onTranslate = ({deltaX, deltaY}) =>
            setView(
                this,
                composeView(this.view, {
                    x: deltaX / viewport.width,
                    y: deltaY / viewport.height,
                    zoom: 1,
                    atX: 0,
                    atY: 0
                })
            );
        // A preview does not draw a rotation, but the camera has left its frame all the same.
        this.onRotate = () => setView(this, {...this.view, offFrame: true});
        controller.on(PlayerControllerEvents.zoom, this.onZoom);
        controller.on(PlayerControllerEvents.translate, this.onTranslate);
        controller.on(PlayerControllerEvents.rotate, this.onRotate);
    }

    /** The view as it is now, `ON_FRAME` until the camera moves.
     *
     * @readonly
     * @type {CameraView}
     */
    get view() {
        return this.current;
    }

    /** Put the view back on its frame, and report it unless it was there already. */
    reset() {
        setView(this, ON_FRAME);
    }

    /** Stop following the controller. */
    dispose() {
        this.controller.off(PlayerControllerEvents.zoom, this.onZoom);
        this.controller.off(PlayerControllerEvents.translate, this.onTranslate);
        this.controller.off(PlayerControllerEvents.rotate, this.onRotate);
    }
}
