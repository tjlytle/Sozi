/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Step a deck's player for the exporter.
 *
 * The exporter calls into the export window with `webContents.executeJavaScript`,
 * one call per step: there is no message and no timer here, so every capture is deterministic.
 *
 * @module
 */

/** Drive the transitions of a player one step at a time, for the exporter. */
export class ExportDriver {
    /** Create a driver for a player.
     *
     * @param {import("./Player").Player} player - The player to drive.
     * @param {import("../model/Presentation").Presentation} presentation - The presentation it plays.
     * @param {import("./Viewport").Viewport} viewport - The viewport it shows the presentation in.
     */
    constructor(player, presentation, viewport) {
        /** The player to drive. */
        this.player = player;

        /** The presentation it plays. */
        this.presentation = presentation;

        /** The viewport it shows the presentation in. */
        this.viewport = viewport;

        /** Whether the repaint loop started by `kick(true)` is running. */
        this.kicking = false;

        /** @type {number | null} The id of the animation frame the repaint loop waits for. */
        this.frameRequest = null;
    }

    /** Prepare the transition from the current frame to another frame.
     *
     * @param {number} nextIndex - The index of the target frame.
     * @returns {number} - The duration of the transition, in milliseconds.
     */
    setup(nextIndex) {
        const player = this.player;
        player.pause();
        player.transitions = [];
        player.targetFrame = this.presentation.frames[nextIndex];
        const layerProperties = player.targetFrame.layerProperties;
        for (const camera of this.viewport.cameras) {
            const lp = layerProperties[camera.layer.index];
            player.setupTransition(
                camera,
                lp.transitionTimingFunction,
                lp.transitionRelativeZoom,
                lp.transitionPath
            );
        }
        return player.targetFrame.transitionDurationMs;
    }

    /** Move the cameras to a given point of the current transition.
     *
     * @param {number} progress - The relative time elapsed in the transition (between 0 and 1).
     */
    step(progress) {
        this.player.onAnimatorStep(progress);
    }

    /** Start or stop repainting the viewport at each animation frame.
     *
     * A hidden window produces no new frame while its content is static, and the
     * Chrome DevTools Protocol waits for one before it takes a screenshot.
     * Repainting with the current camera states produces new frames with the same pixels.
     *
     * @param {boolean} enable - Start (`true`) or stop (`false`) repainting.
     */
    kick(enable) {
        // Do not start a second repaint loop.
        if (enable && this.kicking) {
            return;
        }
        this.kicking = enable;
        const loop = () => {
            if (this.kicking) {
                this.viewport.repaint();
                this.frameRequest = requestAnimationFrame(loop);
            }
        };
        if (enable) {
            loop();
        } else if (this.frameRequest !== null) {
            cancelAnimationFrame(this.frameRequest);
            this.frameRequest = null;
        }
    }

    /** The state of the player, for the exporter to check before a capture.
     *
     * @returns {{index: number, animating: boolean}} - The index of the current frame, and
     *  whether the player's own animation is running.
     */
    state() {
        const player = this.player;
        return {index: player.currentFrame.index, animating: player.animator.running};
    }

    /** Terminate the current transition and show its target frame.
     *
     * @returns {number} - The index of the frame shown.
     */
    finish() {
        const player = this.player;
        const index = player.targetFrame.index;
        player.transitions = [];
        player.jumpToFrame(index);
        return index;
    }

    /** Stop the repaint loop and cancel its pending frame. */
    dispose() {
        this.kick(false);
    }
}
