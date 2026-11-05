/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The names of the events a `Player` emits.
 *
 * In a module of its own so that code that only listens (and its unit tests, under node)
 * need not load the player.
 *
 * @module
 */

/** The events a `Player` emits (standard 2.4).
 *
 * @readonly
 */
export const PlayerEvents = Object.freeze({
    frameChange: "frameChange",
    stateChange: "stateChange",
    blankScreenChange: "blankScreenChange"
});
