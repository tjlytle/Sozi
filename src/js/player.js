/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {SVGDocumentWrapper} from "./svg/SVGDocumentWrapper";
import {Presentation, Frame} from "./model/Presentation";
import {Viewport} from "./player/Viewport";
import {Player} from "./player/Player";
import {PlayerEvents} from "./player/playerEvents";
import {PlayerController} from "./player/PlayerController";
import {DisplayChannel} from "./player/DisplayChannel";
import {DisplayApi} from "./player/DisplayApi";
import {PairingOverlay} from "./player/PairingOverlay";
import {ExportDriver} from "./player/ExportDriver";
import {enterPreviewMode} from "./player/PreviewMode";
import * as Media from "./player/Media";
import * as FrameList from "./player/FrameList";
import * as FrameNumber from "./player/FrameNumber";
import * as FrameURL from "./player/FrameURL";
import * as TouchGestures from "./player/TouchGestures";
import {LocalTransport} from "./protocol/LocalTransport";

/** Initialize the Sozi player when the document is loaded.
 *
 * @param {DisplayApi} display - The API add-ons have been calling since the module loaded.
 * @param {any} deck - What `window.sozi` reads the deck's objects from; filled here.
 */
function startPlayer(display, deck) {
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

    const exportDriver = new ExportDriver(player, presentation, viewport);

    Object.assign(deck, {presentation, viewport, player, playerController, exportDriver});

    player.on(PlayerEvents.stateChange, () => {
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

    startDisplay(display, player, playerController, presentation);
}

/** Connect the deck to its surfaces, and do what add-ons have asked of `display` so far.
 *
 * @param {DisplayApi} display - The API add-ons have been calling since the module loaded.
 * @param {Player} player - The deck's player.
 * @param {PlayerController} controller - The deck's player controller.
 * @param {Presentation} presentation - The deck's presentation.
 */
function startDisplay(display, player, controller, presentation) {
    // The presenter console that opened this window, the page this deck is framed in, or
    // this window itself: then the transport only hands on what the page posts to itself.
    const transport = new LocalTransport(window, window.opener || window.parent);
    // Cast: src/templates/player.html holds the overlay's element.
    const pairingElement = /** @type {HTMLElement} */ (document.querySelector(".sozi-pairing"));
    const pairing = new PairingOverlay(pairingElement, window, display);
    const channel = new DisplayChannel({
        player,
        controller,
        presentation,
        transport,
        host: window,
        enterPreviewMode: (isCurrent, onFollowLink, onKey) => {
            // A preview hands its keys to the presenter: Q is not for it.
            pairing.dispose();
            enterPreviewMode(player, presentation, isCurrent, onFollowLink, onKey);
        }
    });
    channel.start();
    display.start(channel, pairing);
}

/** Publish `window.sozi` when the module loads. Custom scripts run before `load`, so
 * `display` must be there at once; the deck's objects are filled on load.
 */
function publish() {
    const display = new DisplayApi();
    const deck = {};
    window.sozi = {
        display,
        get presentation() {
            return deck.presentation;
        },
        get viewport() {
            return deck.viewport;
        },
        get player() {
            return deck.player;
        },
        get playerController() {
            return deck.playerController;
        },
        get exportDriver() {
            return deck.exportDriver;
        }
    };
    window.addEventListener("load", () => startPlayer(display, deck));
}

publish();
