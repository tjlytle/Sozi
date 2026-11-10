/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Show the current frame number.
 *
 * This module is part of the Sozi player embedded in each presentation.
 *
 * @module
 */

import * as FrameList from "./FrameList";
import {PlayerEvents} from "./playerEvents";

/** Initialize the frame number management.
 *
 * This function registers event handlers:
 * - A {@linkcode module:player/Player.frameChange|frameChange} event from the Sozi player will update the frame number.
 * - A `click` event on the frame number will open the frame list.
 *
 * @param {module:player/Player.Player} player - The current Sozi player.
 */
export function init(player) {
    // Cast: the player page always has a frame number element.
    const frameNumber = /** @type {HTMLElement} */ (document.querySelector(".sozi-frame-number"));

    player.on(PlayerEvents.frameChange, () => {
        frameNumber.textContent = String(player.currentFrame.index + 1);
        frameNumber.classList.toggle(
            "sozi-frame-number--hidden",
            !player.currentFrame.showFrameNumber
        );
    });

    frameNumber.addEventListener("click", FrameList.open);
}
