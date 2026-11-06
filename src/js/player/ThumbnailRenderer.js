/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

/** The quality of a thumbnail's JPEG, from 0 to 1.
 *
 * @readonly
 * @default
 * @type {number}
 */
const JPEG_QUALITY = 0.7;

/** What shows through a transparent deck, as a JPEG has no transparency.
 *
 * @readonly
 * @default
 * @type {string}
 */
const BACKGROUND = "white";

/** Draws frames of a deck as images, for a surface's frame picker.
 *
 * A frame's view is one camera per layer, so only the deck can draw it. It serialises its SVG
 * to a `data:` URL, because a `blob:` URL taints the canvas when the SVG holds a
 * `foreignObject`. An SVG drawn as an image loads nothing external, so linked images are missing.
 */
export class ThumbnailRenderer {
    /** Keep the deck's objects.
     *
     * @param {object} options - The deck's objects.
     * @param {any} options.player - The deck's player.
     * @param {any} options.viewport - The deck's viewport.
     * @param {any} options.presentation - The deck's presentation.
     * @param {Window & typeof globalThis} options.host - The window the deck plays in.
     */
    constructor({player, viewport, presentation, host}) {
        this.player = player;
        this.viewport = viewport;
        this.presentation = presentation;
        this.host = host;

        /** Where each thumbnail is drawn.
         *
         * @type {HTMLCanvasElement}
         */
        this.canvas = host.document.createElement("canvas");
    }

    /** Move the player to a frame and draw what it shows.
     *
     * @param {number} index - The frame's position, from 0.
     * @param {number} width - The thumbnail's width, in pixels.
     * @returns {Promise<string>} The thumbnail, as a JPEG `data:` URL.
     * @throws {RangeError} If the deck has no such frame.
     */
    async render(index, width) {
        if (!this.presentation.frames[index]) {
            throw new RangeError(`The deck has no frame ${index}`);
        }
        this.player.jumpToFrame(index);
        this.viewport.repaint();
        const svg = new this.host.XMLSerializer().serializeToString(this.viewport.svgRoot);
        const image = new this.host.Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await image.decode();

        const {canvas} = this;
        canvas.width = width;
        canvas.height = Math.max(1, Math.round((width * image.height) / image.width));
        const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
        context.fillStyle = BACKGROUND;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    }

    /** Let go of the canvas's memory. */
    dispose() {
        this.canvas.width = this.canvas.height = 0;
    }
}
