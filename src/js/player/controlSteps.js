/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The steps the mouse, the keys and the preview gestures share: how far a drag must go, how
 * much one zoom step scales and how much one rotate step turns.
 *
 * @module
 */

/** The minimum distance to detect a drag action, in pixels.
 *
 * @readonly
 * @default
 * @type {number}
 */
export const DRAG_THRESHOLD_PX = 5;

/** The zoom step factor for user zoom action (keyboard and mouse wheel).
 *
 * @readonly
 * @default
 * @type {number}
 */
export const SCALE_FACTOR = 1.05;

/** The rotation step angle for user rotate action (keyboard and mouse wheel), in degrees.
 *
 * @readonly
 * @default
 * @type {number}
 */
export const ROTATE_STEP = 5;
