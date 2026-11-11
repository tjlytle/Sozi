/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The events a player controller emits, in their own module so that the mouse and the keys can
 * emit them without importing the controller that creates them.
 *
 * @module
 */

/** Signals that a user action will make the presentation jump to another frame.
 *
 * The event is emitted before the transition.
 * Its argument is the target frame.
 *
 * @event module:player/PlayerController.jumpToFrame
 * @type {module:model/Presentation.Frame}
 */

/** Signals that a user action will make the presentation move to another frame.
 *
 * The event is emitted before the transition.
 * Its argument is the target frame.
 *
 * @event module:player/PlayerController.moveToFrame
 * @type {module:model/Presentation.Frame}
 */

/** Signals that a user action will make the presentation move to another frame in *preview* mode.
 *
 * The event is emitted before the transition.
 * Its argument is the target frame.
 *
 * @event module:player/PlayerController.previewFrame
 * @type {module:model/Presentation.Frame}
 */

/** Signals that a user action will trigger the "view all" feature.
 *
 * The event is emitted before the transition.
 *
 * @event module:player/PlayerController.viewAll
 */

/** Signals that a user action has paused the presentation.
 *
 * @event module:player/PlayerController.pause
 */

/** Signals that a user action has toggled the blank screen status.
 *
 * When emitted, the argument indicates the new blank screen status.
 *
 * @event module:player/PlayerController.toggleBlankScreen
 * @type {boolean}
 */

/** Signals that a user action has changed the zoom level.
 *
 * The event is emitted after applying the transformation.
 *
 * @event module:player/PlayerController.zoom
 * @type {object}
 * @property {number} factor - The zoom factor.
 * @property {number} x      - The x coordinate of the screenpoint to focus while zooming.
 * @property {number} y      - The y coordinate of the screenpoint to focus while zooming.
 * @todo We should send the new absolute camera states instead of the current transformation.
 */

/** Signals that a user action has changed the rotation angle.
 *
 * The event is emitted after applying the transformation.
 * Its argument is the angle.
 *
 * @event module:player/PlayerController.rotate
 * @type {number}
 * @todo We should send the new absolute camera states instead of the current transformation.
 */

/** Signals that a user action has performed a translation.
 *
 * The event is emitted after applying the transformation.
 *
 * @event module:player/PlayerController.translate
 * @type {object}
 * @property {number} deltaX - The horizontal displacement, in pixels.
 * @property {number} deltaY - The vertical displacement, in pixels.
 * @todo We should send the new absolute camera states instead of the current transformation.
 */

/** Signals a mouse click in a viewport.
 *
 * @event module:player/PlayerController.click
 */

/** Signals a mouse button press in a viewport.
 *
 * @event module:player/PlayerController.mouseDown
 */

/** Signals the possible start of a drag gesture in a viewport.
 *
 * @event module:player/PlayerController.dragStart
 */

/** Signals the end of a drag gesture in a viewport.
 *
 * @event module:player/PlayerController.dragEnd
 */

/** Signals a user-activated change in the camera states of a viewport.
 *
 * @event module:player/PlayerController.localViewportChange
 */

/** The events a `PlayerController` emits (standard 2.4).
 *
 * @readonly
 */
export const PlayerControllerEvents = Object.freeze({
    mouseDown: "mouseDown",
    dragStart: "dragStart",
    dragEnd: "dragEnd",
    localViewportChange: "localViewportChange",
    click: "click",
    zoom: "zoom",
    rotate: "rotate",
    translate: "translate",
    moveToFrame: "moveToFrame",
    previewFrame: "previewFrame",
    viewAll: "viewAll",
    jumpToFrame: "jumpToFrame",
    pause: "pause",
    toggleBlankScreen: "toggleBlankScreen"
});
