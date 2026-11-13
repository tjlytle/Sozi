// A display channel started on the fakes of fakeDeck.js, and the hello it sends, shared by
// DisplayChannel.test.js, DisplayChannel-timer.test.js and DisplayChannel-drawings.test.js.

import {fakeController, fakeHost, fakePlayer, fakeTransport, frames} from "./fakeDeck.js";
import {DisplayChannel} from "../../../src/js/player/DisplayChannel.js";
import {TalkTimer} from "../../../src/js/player/TalkTimer.js";
import {ON_FRAME} from "../../../src/js/protocol/camera.js";
import {Roles, helloMessage} from "../../../src/js/protocol/hello.js";

/** What a thumbnail render gives. */
export const JPEG = "data:image/jpeg;base64,AAAA";

/** The first frame, as the protocol reports it. */
export const firstFrame = Object.freeze({index: 0, id: "f1", title: "One", notes: "first"});

/** The second frame, as the protocol reports it. */
export const secondFrame = Object.freeze({index: 1, id: "f2", title: "Two", notes: "second"});

/** Every frame of the deck, as the protocol reports it. */
export const everyFrame = Object.freeze([firstFrame, secondFrame]);

/** A stand-in for `enterPreviewMode` that records each preview it makes. A current preview has
 * a pen, which records the tools it is given.
 *
 * @param {any[]} previews - Where each preview goes, with what it reports to and its pen.
 * @returns {(options: any) => any} - The stand-in; it returns the pen, or null.
 */
function fakePreviewMode(previews) {
    return ({isCurrent, onFollowLink, onKey, onCamera, onDrawing, drawings}) => {
        /** @type {any[]} */
        const tools = [];
        const pen = isCurrent ? {tools, setTool: tool => tools.push(tool)} : null;
        previews.push({
            current: isCurrent,
            onFollowLink,
            onKey,
            onCamera,
            onDrawing,
            drawings,
            pen
        });
        return pen;
    };
}

/** Build a display channel on fakes, started, with what it sent on start cleared.
 *
 * @returns {any} - The channel and its fakes.
 */
export function startedDisplay() {
    const player = fakePlayer();
    const controller = fakeController(player);
    const transport = fakeTransport();
    const host = fakeHost();
    const presentation = {frames};
    const previews = [];
    const renders = [];
    const clock = {time: 0};
    const timer = new TalkTimer(() => clock.time);
    const drawingLayer = {
        rendered: /** @type {any[]} */ ([]),
        render(drawings) {
            this.rendered.push(drawings);
        }
    };
    const channel = new DisplayChannel({
        drawingLayer,
        renderThumbnail: async (index, width) => {
            renders.push([index, width]);
            return JPEG;
        },
        timer,
        player,
        controller,
        presentation,
        transport,
        host,
        enterPreviewMode: fakePreviewMode(previews)
    });
    channel.start();
    const startSent = transport.sent.splice(0);
    return {
        channel,
        player,
        controller,
        transport,
        host,
        previews,
        renders,
        startSent,
        timer,
        clock,
        drawingLayer
    };
}

/** The hello a display sends in the given state.
 *
 * @param {object} changes - The fields that differ from the first frame, not blank.
 * @returns {object} - The message.
 */
export function displayHello(changes = {}) {
    return helloMessage(Roles.display, {
        deckId: "basic",
        version: "11/06/2026 18:26:48",
        frameCount: 2,
        viewport: {width: 1200, height: 400, pixelRatio: 2},
        frame: firstFrame,
        frames: everyFrame,
        blank: false,
        camera: ON_FRAME,
        ...changes
    });
}
