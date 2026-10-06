/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Page-side helper of the exporter.
 *
 * This preload script runs in the export window (with context isolation
 * disabled) and only installs `window.__soziExport`. The exporter drives it
 * from the caller with `webContents.executeJavaScript`, one call per step:
 * there is no IPC and no timer here, so every capture is deterministic.
 */

window.__soziExport = {
    /** Prepare the transition from the current frame to another frame.
     *
     * @param {number} nextIndex - The index of the target frame.
     * @returns {number} - The duration of the transition, in milliseconds.
     */
    setup(nextIndex) {
        const player = window.sozi.player;
        player.pause();
        player.transitions = [];
        player.targetFrame = window.sozi.presentation.frames[nextIndex];
        const layerProperties = player.targetFrame.layerProperties;
        for (const camera of window.sozi.viewport.cameras) {
            const lp = layerProperties[camera.layer.index];
            player.setupTransition(camera, lp.transitionTimingFunction, lp.transitionRelativeZoom, lp.transitionPath);
        }
        return player.targetFrame.transitionDurationMs;
    },

    /** Move the cameras to a given point of the current transition.
     *
     * @param {number} progress - The relative time elapsed in the transition (between 0 and 1).
     */
    step(progress) {
        window.sozi.player.onAnimatorStep(progress);
    },

    /** Start or stop repainting the viewport at each animation frame.
     *
     * A hidden window produces no new frame while its content is static, and the
     * Chrome DevTools Protocol waits for one before it takes a screenshot.
     * Repainting with the current camera states produces new frames with the same pixels.
     *
     * @param {boolean} enable - Start (`true`) or stop (`false`) repainting.
     */
    kick(enable) {
        this.kicking = enable;
        const loop = () => {
            if (this.kicking) {
                window.sozi.viewport.repaint();
                requestAnimationFrame(loop);
            }
        };
        if (enable) {
            loop();
        }
    },

    /** Terminate the current transition and show its target frame.
     *
     * @returns {number} - The index of the frame shown.
     */
    finish() {
        const player = window.sozi.player;
        const index = player.targetFrame.index;
        player.transitions = [];
        player.jumpToFrame(index);
        return index;
    }
};
