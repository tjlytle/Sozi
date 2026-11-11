/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Turn a deck into a preview for the presenter console.
 *
 * @module
 */

import {PreviewGestures} from "./PreviewGestures.js";
import {editableField, isEditableTarget} from "../protocol/editable.js";

/** @typedef {import("./Player.js").Player} Player */
/** @typedef {import("../model/Presentation.js").Presentation} Presentation */
/** @typedef {import("../svg/SVGDocumentWrapper.js").SVGDocumentWrapper} SVGDocumentWrapper */
/** @typedef {import("../protocol/messages.js").KeyModifiers} KeyModifiers */
/** @typedef {import("../protocol/camera.js").CameraMove} CameraMove */

/** Put a player in preview mode.
 *
 * The presenter console uses several players as *previews* of the previous, current and
 * next frames.
 *
 * In preview mode, keyboard and mouse navigation, zoom and rotation are disabled, frame
 * numbers are hidden, hyperlinks in the previous and next views are disabled, and in the
 * current view, hyperlink clicks are reported so that the display follows them, and so are
 * its pans and zooms, which the display makes and the preview then shows. Every key pressed in
 * a preview, outside a field a person types into, is reported, so that the presentation keys
 * work while it has the focus. A click on such a field gives it the focus.
 *
 * @param {object} options - The deck and what to report to.
 * @param {Player} options.player - The deck's player.
 * @param {Presentation} options.presentation - The deck's presentation.
 * @param {boolean} options.isCurrent - Does this preview show the current frame?
 * @param {(id: string) => void} options.onFollowLink - Called with the id of each link clicked
 *   in the current view.
 * @param {(key: string, modifiers: KeyModifiers) => void} options.onKey - Called with each key
 *   pressed in the preview, outside a field a person types into.
 * @param {(move: CameraMove) => void} options.onCamera - Called with each pan and zoom made on
 *   the current view.
 */
export function enterPreviewMode({player, presentation, isCurrent, onFollowLink, onKey, onCamera}) {
    // Cast of presentation.document in this function: previews start after the player has loaded.
    player.disableMedia();
    player.pause();

    presentation.enableMouseTranslation =
        presentation.enableMouseZoom =
        presentation.enableMouseRotation =
        presentation.enableMouseNavigation =
        presentation.enableKeyboardZoom =
        presentation.enableKeyboardRotation =
        presentation.enableKeyboardNavigation =
            false;

    for (const frame of presentation.frames) {
        frame.showFrameNumber = false;
    }

    const svg = /** @type {SVGDocumentWrapper} */ (presentation.document);
    reportKeys(svg.root, onKey);

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
        // The deck lives as long as the preview, so the gestures are never disposed.
        new PreviewGestures({root: svg.root, viewport: player.viewport, onMove: onCamera});
    } else {
        svg.disableHyperlinks(true);
    }
}

/** Report the keys pressed in a preview, outside a field a person types into.
 *
 * A click in the preview gives the focus to the field it lands in, or to the editing host of
 * the editable content it lands in, and takes it away from a field otherwise.
 *
 * @param {SVGSVGElement} root - The root of the deck's SVG document.
 * @param {(key: string, modifiers: KeyModifiers) => void} onKey - Called with each key.
 */
function reportKeys(root, onKey) {
    root.ownerDocument.addEventListener(
        "keydown",
        evt => {
            // Read at each key, so that the keys work again once the focus leaves the field.
            if (isEditableTarget(evt.target)) {
                return;
            }
            onKey(evt.key, {
                shift: evt.shiftKey,
                alt: evt.altKey,
                ctrl: evt.ctrlKey,
                meta: evt.metaKey
            });
        },
        false
    );
    // The player's mousedown handler keeps a click from moving the focus: to the preview, which
    // needs it for its keys, to a field in the deck, which needs it to be typed into, or away
    // from that field. A click on text nested in editable content gives the focus to its host.
    // Cast: a loaded deck's document has a window.
    const view = /** @type {Window} */ (root.ownerDocument.defaultView);
    root.addEventListener("pointerdown", evt => {
        view.focus();
        // Cast: a field a person types into is an HTML element.
        const field = /** @type {?HTMLElement} */ (editableField(evt.target));
        const focused = /** @type {?HTMLElement} */ (root.ownerDocument.activeElement);
        if (field) {
            field.focus();
        } else if (focused && isEditableTarget(focused)) {
            focused.blur();
        }
    });
}
