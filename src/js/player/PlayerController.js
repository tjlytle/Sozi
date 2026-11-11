/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {EventEmitter} from "events";
import {PlayerControllerEvents} from "./playerControllerEvents.js";
import {PlayerKeys} from "./PlayerKeys.js";
import {PlayerMouse} from "./PlayerMouse.js";

export {PlayerControllerEvents};

/** @typedef {import("../model/Presentation.js").Frame} Frame */

/** @typedef {import("./Viewport.js").Viewport} Viewport */
/** @typedef {import("../model/Presentation.js").Presentation} Presentation */

/** The player's event handling controller
 *
 * The controller performs the navigation and view actions on the associated viewport, and
 * signals each one as an event. Its `PlayerMouse` and `PlayerKeys` turn the mouse and the keys
 * into these actions.
 * It also provides an interface to external ui event handlers:
 * - TouchGestures
 *
 * @extends EventEmitter
 */
export class PlayerController extends EventEmitter {
    /** Initialize a new Sozi player controller.
     *
     * If the presentation is opened in edit mode, the controller will disable
     * these features on the corresponding player:
     * - mouse and keyboard actions for navigating in the presentation,
     * - automatic transitions after a timeout.
     *
     * @param {module:player/Player.Player} player - The player attached to this controller.
     * @param {EventTarget} [keyTarget] - Where the keys are pressed; the window by default.
     */
    constructor(player, keyTarget = window) {
        super();

        /** The associated player.
         *
         * @type {module:model/Player.Player}
         */
        this.player = player;

        /** The mouse on the deck, created on each load.
         *
         * @type {?PlayerMouse}
         */
        this.mouse = null;

        /** The keys pressed in the window; none in the editor.
         *
         * @type {?PlayerKeys}
         */
        this.keys = this.editMode ? null : new PlayerKeys(this, keyTarget);
    }

    /** The viewport of the player attached to this controller.
     *
     * @returns {Viewport} - The viewport.
     */
    get viewport() {
        return this.player.viewport;
    }

    /** The presentation of the player attached to this controller.
     *
     * @returns {Presentation} - The presentation.
     */
    get presentation() {
        return this.player.presentation;
    }

    /** Is the viewport of the player in the editor?
     *
     * @returns {boolean} - `true` in the editor, `false` in the player.
     */
    get editMode() {
        return this.player.viewport.editMode;
    }

    /** Listen to the mouse on the deck the viewport has just loaded.
     *
     * The mouse of an earlier load is disposed first: the editor loads the deck again on
     * every change to it.
     */
    onLoad() {
        if (this.mouse) {
            this.mouse.dispose();
        }
        this.mouse = new PlayerMouse(this, this.viewport.svgRoot);
    }

    /** Stop listening to the mouse and the keys. */
    dispose() {
        if (this.mouse) {
            this.mouse.dispose();
            this.mouse = null;
        }
        if (this.keys) {
            this.keys.dispose();
            this.keys = null;
        }
    }

    /** Helper for zoom.
     *
     * @param {number} factor - The zoom factor.
     * @param {number} x      - The x coordinate of the screenpoint to focus while zooming.
     * @param {number} y      - The y coordinate of the screenpoint to focus while zooming.
     *
     * @fires module:player/PlayerController.zoom
     */
    zoom(factor, x, y) {
        this.player.pause();
        this.viewport.zoom(factor, x, y);
        this.emit(PlayerControllerEvents.zoom, {factor, x, y});
    }

    /** Helper for rotation.
     *
     * @param {number} angle - The rotation angle, in degrees.
     *
     * @fires module:player/PlayerController.rotate
     */
    rotate(angle) {
        this.player.pause();
        this.viewport.rotate(angle);
        this.emit(PlayerControllerEvents.rotate, angle);
    }

    /** helper for translation by x and y offset.
     *
     * @param {number} deltaX - The horizontal displacement, in pixels.
     * @param {number} deltaY - The vertical displacement, in pixels.
     *
     * @fires module:player/PlayerController.translate
     */
    translate(deltaX, deltaY) {
        this.viewport.translate(deltaX, deltaY);
        this.emit(PlayerControllerEvents.translate, {deltaX, deltaY});
    }

    /** The index of the presentation's last frame
     *
     * @readonly
     * @type {number}
     */
    get lastFrame() {
        return this.player.presentation.frames.length - 1;
    }

    /** Jumps to the first frame of the presentation.
     *
     * @fires module:player/PlayerController.jumpToFrame
     * @fires module:player/Player.frameChange
     */
    jumpToFirst() {
        this.jumpToFrame(0);
    }

    /** Jump to the last frame of the presentation.
     *
     * @fires module:player/PlayerController.jumpToFrame
     * @fires module:player/Player.frameChange
     */
    jumpToLast() {
        this.jumpToFrame(this.lastFrame);
    }

    /** Jump to the previous frame.
     *
     * @fires module:player/PlayerController.jumpToFrame
     * @fires module:player/Player.frameChange
     */
    jumpToPrevious() {
        this.jumpToFrame(this.player.previousFrame);
    }

    /** Jumps to the next frame.
     *
     * @fires module:player/PlayerController.jumpToFrame
     * @fires module:player/Player.frameChange
     */
    jumpToNext() {
        this.jumpToFrame(this.player.nextFrame);
    }

    /** Move to the first frame of the presentation.
     *
     * @fires module:player/PlayerController.moveToFrame
     * @fires module:player/Player.frameChange
     * @fires module:player/Player.stateChange
     */
    moveToFirst() {
        this.moveToFrame(0);
    }

    /** Move to the previous frame.
     *
     * This method skips previous frames with 0 ms timeout.
     *
     * @fires module:player/PlayerController.moveToFrame
     * @fires module:player/Player.frameChange
     * @fires module:player/Player.stateChange
     */
    moveToPrevious() {
        const frame = this.player.lastNonAutoTransitionFrame();
        if (frame) {
            this.moveToFrame(frame);
        }
    }

    /** Move to the next frame.
     *
     * @fires module:player/PlayerController.moveToFrame
     * @fires module:player/Player.frameChange
     * @fires module:player/Player.stateChange
     */
    moveToNext() {
        this.emit(PlayerControllerEvents.moveToFrame, this.player.nextFrame);
        this.player.moveToNext();
    }

    /** Move to the last frame of the presentation.
     *
     * @fires module:player/PlayerController.moveToFrame
     * @fires module:player/Player.frameChange
     * @fires module:player/Player.stateChange
     */
    moveToLast() {
        this.moveToFrame(this.lastFrame);
    }

    /** Restore the current frame and resume playing.
     *
     * @fires module:player/PlayerController.moveToFrame
     * @fires module:player/Player.frameChange
     * @fires module:player/Player.stateChange
     */
    moveToCurrent() {
        if (!this.player.playing) {
            this.moveToFrame(this.player.currentFrame);
        }
    }

    /** Move to a frame in *preview* mode.
     *
     * @param {string|number|Frame} frame - The frame to show.
     *
     * @fires module:player/PlayerController.previewFrame
     * @fires module:player/Player.frameChange
     * @fires module:player/Player.stateChange
     */
    previewFrame(frame) {
        const f = this.player.findFrame(frame);
        this.emit(PlayerControllerEvents.previewFrame, f);
        this.player.previewFrame(f);
    }

    /**
     *
     */
    viewAll() {
        this.emit(PlayerControllerEvents.viewAll);
        this.player.viewAll();
    }

    /** Jump to the given frame of the presentation and signal a local change.
     *
     * @param {string|number|Frame} frame - The frame to show.
     *
     * @fires module:player/PlayerController.jumpToFrame
     * @fires module:player/Player.frameChange
     * @fires module:player/Player.stateChange
     */
    jumpToFrame(frame) {
        const f = this.player.findFrame(frame);
        this.emit(PlayerControllerEvents.jumpToFrame, f);
        this.player.jumpToFrame(f);
    }

    /** Move to the given frame of the presentation and signal a local change.
     *
     * @param {string|number|Frame} frame - The frame to show.
     *
     * @fires module:player/PlayerController.moveToFrame
     * @fires module:player/Player.frameChange
     * @fires module:player/Player.stateChange
     */
    moveToFrame(frame) {
        const f = this.player.findFrame(frame);
        this.emit(PlayerControllerEvents.moveToFrame, f);
        this.player.moveToFrame(f);
    }

    /** Toggles the pause state of the associated player
     *
     * @fires module:player/PlayerController.pause
     * @fires module:player/PlayerController.moveToFrame
     * @fires module:player/Player.stateChange
     */
    togglePause() {
        if (this.player.playing) {
            this.emit(PlayerControllerEvents.pause);
            this.player.pause();
        } else {
            this.moveToFrame(this.player.currentFrame);
        }
    }

    /** Toggle the visibility of the elements that hides the viewport.
     *
     * @fires module:player/PlayerController.toggleBlankScreen
     */
    toggleBlankScreen() {
        if (this.player.blankScreenIsVisible) {
            this.player.disableBlankScreen();
        } else {
            this.player.enableBlankScreen();
        }
        this.emit(PlayerControllerEvents.toggleBlankScreen, this.player.blankScreenIsVisible);
    }
}
