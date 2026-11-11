/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

/** @typedef {import("../protocol/camera.js").CameraView} CameraView */
/** @typedef {import("../protocol/camera.js").CameraMove} CameraMove */

/**
 * What the commands act on.
 *
 * @typedef {object} DisplayCommandsOptions
 * @property {any} player - The deck's player.
 * @property {any} controller - The deck's player controller.
 * @property {any} presentation - The deck's presentation.
 * @property {any} host - The window the deck plays in.
 * @property {() => boolean} isPreview - Is the deck a presenter preview now?
 * @property {(index: number, width: number) => Promise<string>} renderThumbnail - Moves the deck
 *   to a frame and draws it, as a JPEG `data:` URL.
 */

/** Move the player itself, as a preview does. A function, not a private method: jspot parses
 * src at ES2019, which has no `#` methods (#255).
 *
 * @param {any} player - The deck's player.
 * @param {any} frame - The frame, or its index.
 * @param {boolean} transition - Animate the move.
 */
function movePlayer(player, frame, transition) {
    if (transition) {
        player.moveToFrame(frame);
    } else {
        player.jumpToFrame(frame);
    }
}

/** Carries out what a surface asks the deck to do.
 *
 * Each move goes to the controller, or to the player itself once the deck is a preview: a
 * preview follows the talk without the controller's history or its own camera moves.
 */
export class DisplayCommands {
    /** Take the deck's objects.
     *
     * @param {DisplayCommandsOptions} options - What the commands act on.
     */
    constructor({player, controller, presentation, host, isPreview, renderThumbnail}) {
        this.player = player;
        this.controller = controller;
        this.presentation = presentation;
        this.host = host;
        this.isPreview = isPreview;
        this.renderThumbnail = renderThumbnail;
    }

    /** Go to the next frame.
     *
     * @param {boolean} transition - Animate the move.
     */
    next(transition) {
        if (this.isPreview()) {
            movePlayer(this.player, this.player.nextFrame, transition);
        } else if (transition) {
            this.controller.moveToNext();
        } else {
            this.controller.jumpToNext();
        }
    }

    /** Go to the previous frame.
     *
     * @param {boolean} transition - Animate the move.
     */
    previous(transition) {
        if (this.isPreview()) {
            movePlayer(this.player, this.player.previousFrame, transition);
        } else if (transition) {
            this.controller.moveToPrevious();
        } else {
            this.controller.jumpToPrevious();
        }
    }

    /** Go to the frame at an index.
     *
     * @param {number} index - The frame's position, from 0.
     * @param {boolean} transition - Animate the move.
     */
    jumpToFrame(index, transition) {
        if (this.isPreview()) {
            movePlayer(this.player, index, transition);
        } else if (transition) {
            this.controller.moveToFrame(index);
        } else {
            this.controller.jumpToFrame(index);
        }
    }

    /** Show or hide the blank screen.
     *
     * @param {boolean} on - Show it?
     */
    blank(on) {
        if (this.isPreview()) {
            if (on) {
                this.player.enableBlankScreen();
            } else {
                this.player.disableBlankScreen();
            }
        } else if (on !== this.player.blankScreenIsVisible) {
            this.controller.toggleBlankScreen();
        }
    }

    /** Follow a link of the deck, as if it was clicked.
     *
     * @param {string} id - The id of the link element.
     */
    followLink(id) {
        const link = this.presentation.document.root.getElementById(id);
        // SVG <a> elements have no click method, so the click is dispatched.
        if (link) {
            link.dispatchEvent(new this.host.MouseEvent("click"));
        }
    }

    /** Move the display's camera, in its own pixels; the controller's events report the view.
     *
     * @param {CameraMove} move - The move, in viewport units.
     */
    moveCamera({x, y, zoom, atX, atY}) {
        const {width, height} = this.controller.viewport;
        if (zoom !== 1) {
            this.controller.zoom(zoom, atX * width, atY * height);
        }
        if (x !== 0 || y !== 0) {
            this.controller.translate(x * width, y * height);
        }
    }

    /** Bring the camera back to the current frame. */
    resetCamera() {
        this.player.moveToFrame(this.player.currentFrame);
    }

    /** Show a view of the current frame, in a preview only: the deck goes back to its frame,
     * then zooms about its top-left corner and pans.
     *
     * @param {CameraView} view - The view.
     */
    showView({zoom, x, y}) {
        if (!this.isPreview()) {
            return;
        }
        const {viewport} = this.controller;
        this.player.jumpToFrame(this.player.currentFrame);
        viewport.zoom(zoom, 0, 0);
        viewport.translate(x * viewport.width, y * viewport.height);
    }

    /** Draw a frame as a thumbnail.
     *
     * @param {number} index - The frame's position, from 0.
     * @param {number} width - The thumbnail's width, in pixels.
     * @returns {Promise<string>} A JPEG `data:` URL, or `""` when the frame could not be drawn.
     */
    async thumbnail(index, width) {
        try {
            return await this.renderThumbnail(index, width);
        } catch (err) {
            // The empty URL tells the surface; the tile keeps its number and title.
            console.warn(`No thumbnail for frame ${index}: ${err}`);
            return "";
        }
    }
}
