/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Turn a deck into a preview for the presenter console.
 *
 * @module
 */

/** @typedef {import("./Player.js").Player} Player */
/** @typedef {import("../model/Presentation.js").Presentation} Presentation */
/** @typedef {import("../svg/SVGDocumentWrapper.js").SVGDocumentWrapper} SVGDocumentWrapper */

/** Put a player in preview mode.
 *
 * The presenter console uses several players as *previews* of the previous, current and
 * next frames.
 *
 * In preview mode, keyboard and mouse navigation are disabled, frame numbers are hidden,
 * hyperlinks in the previous and next views are disabled, and in the current view,
 * hyperlink clicks are reported so that the display follows them.
 *
 * @param {Player} player - The deck's player.
 * @param {Presentation} presentation - The deck's presentation.
 * @param {boolean} isCurrent - Does this preview show the current frame?
 * @param {(id: string) => void} onFollowLink - Called with the id of each link clicked in the current view.
 */
export function enterPreviewMode(player, presentation, isCurrent, onFollowLink) {
    // Cast of presentation.document in this function: previews start after the player has loaded.
    player.disableMedia();
    player.pause();

    presentation.enableMouseTranslation =
        presentation.enableMouseNavigation =
        presentation.enableKeyboardZoom =
        presentation.enableKeyboardRotation =
        presentation.enableKeyboardNavigation =
            false;

    for (const frame of presentation.frames) {
        frame.showFrameNumber = false;
    }

    const svg = /** @type {SVGDocumentWrapper} */ (presentation.document);
    if (isCurrent) {
        // Report hyperlink clicks so that the display follows them.
        for (const link of svg.root.getElementsByTagName("a")) {
            link.addEventListener(
                "click",
                evt => {
                    if (link.id) {
                        onFollowLink(link.id);
                    }
                    evt.preventDefault();
                },
                false
            );
        }
    } else {
        svg.disableHyperlinks(true);
    }
}
