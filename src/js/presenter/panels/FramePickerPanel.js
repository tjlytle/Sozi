/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {isBlankHTML, setSanitizedHTML} from "../../html/sanitize";
import {frameOfTarget, matchFrames} from "../framePicker.js";
import {PresenterEvents} from "../PresenterApi.js";
import {TileGestures} from "../TileGestures.js";
import {Roles} from "../../protocol/hello.js";
import {MessageNames} from "../../protocol/messages.js";

/** @typedef {import("../PresenterApi.js").PresenterApi} PresenterApi */
/** @typedef {import("../ThumbnailSource.js").ThumbnailSource} ThumbnailSource */
/** @typedef {import("../../protocol/hello.js").FrameInfo} FrameInfo */

/** The display's shape until it reports one.
 *
 * @readonly
 * @default
 * @type {number}
 */
const DEFAULT_ASPECT = 4 / 3;

/** Make a `div`.
 *
 * @param {Document} doc - The page.
 * @param {string} className - Its class.
 * @returns {HTMLDivElement} The element.
 */
function makeDiv(doc, className) {
    const child = doc.createElement("div");
    child.className = className;
    return child;
}

/** Make the tile of a frame: its number and title, until a thumbnail comes.
 *
 * @param {Document} doc - The page.
 * @param {FrameInfo} frame - The frame.
 * @returns {HTMLButtonElement} The tile.
 */
function makeTile(doc, {index, title}) {
    const tile = doc.createElement("button");
    tile.type = "button";
    tile.className = "sozi-frame-picker__tile";
    tile.dataset.index = String(index);
    const span = (className, text) => {
        const child = doc.createElement("span");
        child.className = className;
        child.textContent = text;
        return child;
    };
    const caption = span("sozi-frame-picker__caption", "");
    caption.append(
        span("sozi-frame-picker__number", String(index + 1)),
        span("sozi-frame-picker__title", title)
    );
    tile.append(span("sozi-frame-picker__thumbnail", ""), caption);
    return tile;
}

/** The Frames panel: a grid with one tile per frame, to go to any frame from.
 *
 * A move goes to the display, and the mark follows what the display reports, never the tap.
 * A key other than Enter on a tile is left to the page, so it still drives the talk.
 */
export class FramePickerPanel {
    /** Draw the panel and follow the display.
     *
     * @param {HTMLElement} element - The element the panel draws into.
     * @param {PresenterApi} api - The presenter's API.
     * @param {ThumbnailSource} thumbnails - Where the thumbnails come from.
     */
    constructor(element, api, thumbnails) {
        this.element = element;
        this.api = api;
        this.thumbnails = thumbnails;
        this.doc = element.ownerDocument;
        this.host = /** @type {Window & typeof globalThis} */ (this.doc.defaultView);

        /** The tiles drawn, by frame.
         *
         * @type {Map<number, HTMLButtonElement>}
         */
        this.tiles = new Map();

        /** What the tiles were drawn from, so that another hello does not draw them again.
         *
         * @type {?string}
         */
        this.drawn = null;

        /** The frame marked, -1 when there is none.
         *
         * @type {number}
         */
        this.marked = -1;

        /** The frames on screen.
         *
         * @type {Set<number>}
         */
        this.visible = new Set();

        /** Did the marked tile change while the panel was not showing? Then it is brought into
         * view when the panel shows.
         *
         * @type {boolean}
         */
        this.revealOnShow = false;

        /** Removes every listener the panel added to its own elements. */
        this.listeners = new AbortController();

        this.filter = this.doc.createElement("input");
        this.grid = makeDiv(this.doc, "sozi-frame-picker__grid");
        this.empty = makeDiv(this.doc, "sozi-frame-picker__empty");
        this.notes = makeDiv(this.doc, "sozi-frame-picker__notes markdown-body");
        this.observer = new this.host.IntersectionObserver(
            entries => this.onIntersections(entries),
            {root: this.grid}
        );

        this.filter.type = "search";
        this.filter.className = "sozi-frame-picker__filter";
        this.filter.placeholder = "Filter frames";
        this.filter.setAttribute("aria-label", "Filter frames");
        this.notes.hidden = true;
        const body = makeDiv(this.doc, "sozi-frame-picker__body");
        body.append(this.grid, this.empty, this.notes);
        const root = makeDiv(this.doc, "sozi-frame-picker");
        root.append(this.filter, body);
        element.append(root);

        this.listen();
        this.draw();

        this.gestures = new TileGestures(this.grid, this.host, index => this.showNotes(index));

        this.onFrameChange = ({index}) => this.mark(index);
        this.onMessage = message => {
            if (message.name === MessageNames.hello && message.role === Roles.display) {
                this.draw();
            }
        };
        api.on(PresenterEvents.frameChange, this.onFrameChange);
        api.on(PresenterEvents.message, this.onMessage);
    }

    /** Listen to the grid and the filter. */
    listen() {
        const {signal} = this.listeners;
        this.grid.addEventListener("click", evt => this.onClick(evt), {signal});
        this.grid.addEventListener("keydown", evt => this.onTileKey(evt), {signal});
        this.filter.addEventListener("input", () => this.applyFilter(), {signal});
        this.filter.addEventListener("keydown", evt => this.onFilterKey(evt), {signal});
    }

    /** The frames as the display last reported them.
     *
     * @readonly
     * @type {FrameInfo[]}
     */
    get frames() {
        return this.api.state.frames;
    }

    /** Draw a tile per frame and ask for their thumbnails, unless nothing has changed. */
    draw() {
        const {frames, deckId, version, viewport, frame} = this.api.state;
        const drawn = JSON.stringify([deckId, version, frames]);
        if (drawn !== this.drawn) {
            this.drawn = drawn;
            this.observer.disconnect();
            this.visible.clear();
            this.tiles = new Map(frames.map(info => [info.index, makeTile(this.doc, info)]));
            this.grid.replaceChildren(...this.tiles.values());
            this.tiles.forEach(tile => this.observer.observe(tile));
            this.marked = -1;
            this.applyFilter();
            if (frames.length) {
                const aspect = viewport ? viewport.width / viewport.height : DEFAULT_ASPECT;
                void this.thumbnails.show(
                    {deckId, version, frameCount: frames.length, aspect},
                    (index, url) => this.setThumbnail(index, url)
                );
            }
        }
        if (frame) {
            this.mark(frame.index);
        }
    }

    /** Show a frame's thumbnail in its tile.
     *
     * @param {number} index - The frame's position, from 0.
     * @param {string} url - The thumbnail, a JPEG `data:` URL the protocol has checked.
     */
    setThumbnail(index, url) {
        const tile = this.tiles.get(index);
        if (tile) {
            const box = /** @type {Element} */ (
                tile.querySelector(".sozi-frame-picker__thumbnail")
            );
            const image = this.doc.createElement("img");
            image.alt = "";
            image.src = url;
            box.replaceChildren(image);
        }
    }

    /** Mark the current frame, and bring it into view when it changes.
     *
     * @param {number} index - The frame's position, from 0.
     */
    mark(index) {
        if (index !== this.marked) {
            const before = this.tiles.get(this.marked);
            const now = this.tiles.get(index);
            if (before) {
                before.removeAttribute("aria-current");
            }
            if (now) {
                now.setAttribute("aria-current", "true");
            }
            this.marked = index;
            this.reveal();
        }
    }

    /** Bring the marked tile into view, now or when the panel next shows. */
    reveal() {
        const showing = this.grid.clientHeight > 0;
        this.revealOnShow = !showing;
        const tile = this.tiles.get(this.marked);
        if (showing && tile) {
            // Only the grid moves: `scrollIntoView` would scroll the whole page behind a tab.
            const box = this.grid.getBoundingClientRect();
            const {top, bottom} = tile.getBoundingClientRect();
            this.grid.scrollTop += Math.min(top - box.top, 0) + Math.max(bottom - box.bottom, 0);
        }
    }

    /** Keep track of the tiles on screen, which are rendered first.
     *
     * @param {IntersectionObserverEntry[]} entries - The tiles that came or went.
     */
    onIntersections(entries) {
        for (const {target, isIntersecting} of entries) {
            const index = Number(/** @type {HTMLElement} */ (target).dataset.index);
            if (isIntersecting) {
                this.visible.add(index);
            } else {
                this.visible.delete(index);
            }
        }
        this.thumbnails.setVisible([...this.visible]);
        if (this.revealOnShow && this.grid.clientHeight > 0) {
            this.reveal();
        }
    }

    /** Hide the tiles the filter leaves out, and say so when that is all of them. */
    applyFilter() {
        const kept = matchFrames(this.frames, this.filter.value);
        const indexes = new Set(kept.map(frame => frame.index));
        this.tiles.forEach((tile, index) => (tile.hidden = !indexes.has(index)));
        // Empty when not needed, so that the page holds the words only while they are true.
        this.empty.textContent = this.frames.length && !kept.length ? "No matching frame" : "";
    }

    /** A tap or a click jumps, unless it ends a long press. It leaves the focus on the page,
     * so that the next key drives the talk.
     *
     * @param {MouseEvent} evt - The click.
     */
    onClick(evt) {
        const index = frameOfTarget(evt.target);
        if (index === null || this.gestures.longPressed) {
            return;
        }
        // A click from the keyboard has no detail, and keeps its focus.
        if (evt.detail > 0) {
            /** @type {HTMLElement} */ (this.tiles.get(index)).blur();
        }
        this.api.display.jumpToFrame(index, !evt.shiftKey);
    }

    /** Enter on a tile jumps there; to the page's own listener, Enter means the next frame.
     *
     * @param {KeyboardEvent} evt - The key.
     */
    onTileKey(evt) {
        const index = frameOfTarget(evt.target);
        if (index !== null && evt.key === "Enter") {
            evt.stopPropagation();
            evt.preventDefault();
            this.api.display.jumpToFrame(index, !evt.shiftKey);
        }
    }

    /** Enter goes to the first frame kept; Escape brings the others back.
     *
     * @param {KeyboardEvent} evt - The key.
     */
    onFilterKey(evt) {
        if (evt.key === "Enter") {
            const [first] = matchFrames(this.frames, this.filter.value);
            if (first) {
                this.api.display.jumpToFrame(first.index, !evt.shiftKey);
            }
        } else if (evt.key === "Escape") {
            this.filter.value = "";
            this.applyFilter();
            this.reveal();
        }
    }

    /** Show a frame's notes, sanitised; a frame with none shows nothing.
     *
     * @param {?number} index - The frame's position, null for none.
     */
    showNotes(index) {
        const frame = index === null ? null : this.frames[index];
        const notes = frame ? frame.notes : "";
        this.notes.hidden = isBlankHTML(notes, this.doc);
        setSanitizedHTML(this.notes, notes);
    }

    /** Stop following the display, stop rendering and empty the element. */
    dispose() {
        this.api.off(PresenterEvents.frameChange, this.onFrameChange);
        this.api.off(PresenterEvents.message, this.onMessage);
        this.listeners.abort();
        this.observer.disconnect();
        this.gestures.dispose();
        this.thumbnails.dispose();
        this.element.replaceChildren();
    }
}
