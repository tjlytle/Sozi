// Ambient types shared by every file. Also the first TypeScript input, so the strict
// check (tsconfig.json) has something to compile before any .ts module exists.
// See docs/software-factory/code-standard.md, section 1.3.

import type {Presentation} from "../model/Presentation.js";
import type {Viewport} from "../player/Viewport.js";
import type {Player} from "../player/Player.js";
import type {PlayerController} from "../player/PlayerController.js";
import type {ExportDriver} from "../player/ExportDriver.js";

/** The player API that player.js assigns to `window.sozi` once the deck has loaded. */
export interface SoziPlayerApi {
    readonly presentation: Presentation;
    readonly viewport: Viewport;
    readonly player: Player;
    readonly playerController: PlayerController;
    /** The step helper that the exporter drives in an export window. */
    readonly exportDriver: ExportDriver;
}

declare global {
    /** The bare global name that player.js reads; the same object as `window.sozi`. */
    const sozi: SoziPlayerApi;

    interface Window {
        /** Assigned by player.js on load (standard 2.3); every reader runs after load or tests it. */
        sozi: SoziPlayerApi;

        /** The deck data that the generated HTML page defines before player.js runs. */
        soziPresentationData: object;
    }

    // Vendor-prefixed and legacy browser APIs that the player still feature-tests.
    interface Window {
        mozRequestAnimationFrame?: typeof requestAnimationFrame;
        webkitRequestAnimationFrame?: typeof requestAnimationFrame;
        msRequestAnimationFrame?: typeof requestAnimationFrame;
        oRequestAnimationFrame?: typeof requestAnimationFrame;
    }

    interface Document {
        /** The legacy WebKit and IE wheel event handler. */
        onmousewheel?: ((this: Document, ev: Event) => unknown) | null;
    }

    interface WheelEvent {
        /** The legacy WebKit and IE wheel delta of a `mousewheel` event. */
        readonly wheelDelta?: number;
    }
}
