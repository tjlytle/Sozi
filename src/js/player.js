/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {SVGDocumentWrapper} from "./svg/SVGDocumentWrapper";
import {Presentation, Frame} from "./model/Presentation";
import {Viewport} from "./player/Viewport";
import {Player} from "./player/Player";
import {PlayerController} from "./player/PlayerController";
import {DisplayChannel} from "./player/DisplayChannel";
import {enterPreviewMode} from "./player/PreviewMode";
import * as Media from "./player/Media";
import * as FrameList from "./player/FrameList";
import * as FrameNumber from "./player/FrameNumber";
import * as FrameURL from "./player/FrameURL";
import * as TouchGestures from "./player/TouchGestures";
import {LocalTransport} from "./protocol/LocalTransport";

// Initialize the Sozi player when the document is loaded.
window.addEventListener("load", () => {
    // Show the SVG before the viewport measures it; the same class hides the spinner.
    document.body.classList.add("sozi-player--ready");

    // Cast: the player page holds the SVG.
    const svgRoot = /** @type {SVGSVGElement} */ (document.querySelector("svg"));

    const presentation = new Presentation();
    presentation.setSVGDocument(new SVGDocumentWrapper(svgRoot));

    const viewport = new Viewport(presentation);
    viewport.onLoad();
    presentation.setInitialCameraState();

    presentation.fromStorable(window.soziPresentationData);
    if (!presentation.frames.length) {
        const frame = new Frame(presentation);
        frame.setAtStates(viewport.cameras);
        presentation.frames.push(frame);
    }

    const player = new Player(viewport, presentation);
    const playerController = new PlayerController(player);
    playerController.onLoad();

    Media.init(player);
    FrameList.init(player, playerController);
    FrameNumber.init(player);
    FrameURL.init(player);
    TouchGestures.init(player, presentation, playerController);

    window.sozi = {
        get presentation() {
            return presentation;
        },
        get viewport() {
            return viewport;
        },
        get player() {
            return player;
        },
        get playerController() {
            return playerController;
        }
    };

    player.on("stateChange", () => {
        if (player.playing) {
            document.title = presentation.title;
        } else {
            document.title = presentation.title + " (Paused)";
        }
    });

    window.addEventListener("resize", () => viewport.repaint());

    player.playFromFrame(FrameURL.getFrame());

    viewport.repaint();
    player.disableBlankScreen();

    // The presenter console that opened this window, the page this deck is framed in, or
    // this window itself: then the transport only hands on what the page posts to itself.
    const transport = new LocalTransport(window, window.opener || window.parent);
    new DisplayChannel({
        player,
        controller: playerController,
        presentation,
        transport,
        host: window,
        enterPreviewMode: (isCurrent, onFollowLink) =>
            enterPreviewMode(player, presentation, isCurrent, onFollowLink)
    }).start();
});
