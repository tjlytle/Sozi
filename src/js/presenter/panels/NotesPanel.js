/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {highlightCode} from "../../html/highlight.js";
import {isBlankHTML, setSanitizedHTML} from "../../html/sanitize";
import {overlayNotes} from "../../notes/notesDocument.js";
import {DisplayMirrorEvents} from "../DisplayMirror.js";
import {linkTarget} from "../noteLinks.js";
import {coveringSection, nextFontSize, notesUrl, readFontSize} from "../notesPosition.js";

/** @typedef {import("../DisplayMirror.js").DisplayMirror} DisplayMirror */
/** @typedef {import("../../protocol/hello.js").FrameInfo} FrameInfo */

/**
 * A section of the document, as drawn.
 *
 * @typedef {object} DrawnSection
 * @property {number} index - The position of its frame, from 0.
 * @property {HTMLElement} element - The element holding the heading and the notes.
 * @property {HTMLElement} heading - The frame's heading.
 */

/**
 * What the Notes panel needs from the page.
 *
 * @typedef {object} NotesPanelOptions
 * @property {Pick<Storage, "getItem" | "setItem">} storage - Where the font size is kept.
 * @property {() => string} deckHref - The address of the deck's page, read when it is needed.
 * @property {(index: number, transition: boolean) => void} jumpToFrame - Moves the display.
 */

/** Where the font size is kept: per device, across decks.
 *
 * @readonly
 * @default
 * @type {string}
 */
const FONT_SIZE_KEY = "sozi-notes-font-size";

/** How much a press of A− or A+ changes the font size, in pixels.
 *
 * @readonly
 * @default
 * @type {number}
 */
const FONT_SIZE_STEP = 2;

/** The room left above a section brought to the top, in pixels.
 *
 * @readonly
 * @default
 * @type {number}
 */
const TOP_GAP = 8;

/** The heading of a frame with an empty title.
 *
 * @readonly
 * @default
 * @type {string}
 */
const UNTITLED = "(untitled)";

/** The Notes panel: the whole deck's notes as one document that follows the talk. */
export class NotesPanel {
    /** Draw the panel and follow the display.
     *
     * @param {HTMLElement} element - The element the panel draws into.
     * @param {DisplayMirror} mirror - What the display last reported.
     * @param {NotesPanelOptions} options - What it needs from the page.
     */
    constructor(element, mirror, {storage, deckHref, jumpToFrame}) {
        this.element = element;
        this.mirror = mirror;
        this.storage = storage;
        this.deckHref = deckHref;
        this.jumpToFrame = jumpToFrame;
        this.doc = element.ownerDocument;

        /** Does the document scroll with the talk?
         *
         * @type {boolean}
         */
        this.following = true;

        /** The sections drawn, in deck order.
         *
         * @type {DrawnSection[]}
         */
        this.sections = [];

        /** What the sections were drawn from, so that the same notes are not drawn twice.
         *
         * @type {?string}
         */
        this.drawn = null;

        /** The frames the sections were drawn from, which the links in the notes name.
         *
         * @type {FrameInfo[]}
         */
        this.drawnFrames = [];

        /** The frame last shown, -1 before the first.
         *
         * @type {number}
         */
        this.shownIndex = -1;

        /** The notes file published beside the deck, null without one.
         *
         * @type {?string}
         */
        this.published = null;

        /** Has the fetch of the published file started?
         *
         * @type {boolean}
         */
        this.fetchStarted = false;

        /** Is the panel gone, so that a late fetch must not draw?
         *
         * @type {boolean}
         */
        this.disposed = false;

        this.fontSize = readFontSize(storage.getItem(FONT_SIZE_KEY));
        this.scrollerHeight = 0;

        this.title = this.doc.createElement("div");
        this.title.className = "sozi-notes-title sozi-notes-title--hidden";
        this.followButton = this.button("Follow", "Scroll the notes with the talk", () =>
            this.setFollowing(!this.following)
        );
        this.followButton.setAttribute("aria-pressed", "true");
        this.body = this.doc.createElement("div");
        this.body.className = "sozi-notes-body markdown-body";
        this.showFontSize();
        this.draw();

        /** Draw new notes and show a new frame.
         *
         * @param {{frame?: FrameInfo, frames?: FrameInfo[]}} part - What changed in the mirror.
         */
        this.onChange = ({frame, frames}) => {
            if (frame || frames) {
                this.update();
            }
        };
        mirror.on(DisplayMirrorEvents.change, this.onChange);

        this.onScroll = () => this.showTitleLine();
        this.body.addEventListener("scroll", this.onScroll, false);

        /** Move the display for a link to a frame; a `#` link never changes the page's address.
         *
         * @param {MouseEvent} evt - The click.
         */
        this.onClick = evt => {
            const link = /** @type {Element} */ (evt.target).closest("a[href]");
            const href = link ? link.getAttribute("href") || "" : "";
            if (!href.startsWith("#")) {
                return;
            }
            evt.preventDefault();
            const target = linkTarget(href, this.drawnFrames);
            if (target.kind === "frame") {
                this.jumpToFrame(target.index, !evt.shiftKey);
            }
        };
        this.body.addEventListener("click", this.onClick, false);

        // Cast: an element in a page always has a window.
        const host = /** @type {Window & typeof globalThis} */ (this.doc.defaultView);
        this.resizeObserver = new host.ResizeObserver(() => this.onResize());
        this.resizeObserver.observe(this.body);

        this.update();
    }

    /** Put the toolbar and the empty document in the panel's element. */
    draw() {
        const toolbar = this.doc.createElement("div");
        toolbar.className = "sozi-notes__toolbar";
        toolbar.append(
            this.title,
            this.followButton,
            this.button("A−", "Smaller notes", () => this.changeFontSize(-FONT_SIZE_STEP)),
            this.button("A+", "Larger notes", () => this.changeFontSize(FONT_SIZE_STEP))
        );

        const notes = this.doc.createElement("div");
        notes.className = "sozi-notes";
        notes.append(toolbar, this.body);
        this.element.append(notes);
    }

    /** A button of the toolbar.
     *
     * @param {string} label - Its text, which is its accessible name.
     * @param {string} title - What it does, shown on hover.
     * @param {() => void} action - What a press does.
     * @returns {HTMLButtonElement} The button.
     */
    button(label, title, action) {
        const button = this.doc.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.title = title;
        button.addEventListener("click", action, false);
        return button;
    }

    /** Take what the mirror holds now: new notes if they changed, then the current frame. */
    update() {
        if (!this.mirror.frame) {
            return;
        }
        this.fetchPublished();
        const redrawn = this.drawSections();
        const {index} = this.mirror.frame;
        const moved = index !== this.shownIndex;
        this.shownIndex = index;

        const covering = coveringSection(this.sections, index);
        for (const section of this.sections) {
            section.element.toggleAttribute("aria-current", section === covering);
        }
        if (this.following) {
            if (redrawn) {
                this.scrollToSection(covering);
            } else if (moved && this.ownSection()) {
                // A frame with no section moves nothing, so the notes being read stay.
                this.scrollToSection(this.ownSection());
            }
        }
        this.showTitleLine();
    }

    /** The current frame's own section, if it has notes.
     *
     * @returns {?DrawnSection} The section.
     */
    ownSection() {
        return this.sections.find(({index}) => index === this.shownIndex) || null;
    }

    /** The frames the document is made of: a published file's notes win over the deck's.
     *
     * A display from before the frames list reports only its current frame.
     *
     * @returns {FrameInfo[]} The frames, in deck order.
     */
    documentFrames() {
        const {frames, frame} = this.mirror;
        const reported = frames.length ? frames : [/** @type {FrameInfo} */ (frame)];
        if (this.published === null) {
            return reported;
        }
        const withFileIds = reported.map(info => ({...info, frameId: info.id}));
        return overlayNotes(withFileIds, this.published).frames;
    }

    /** Draw the sections, unless the same frames are already drawn: a renamed id draws again.
     *
     * @returns {boolean} True if the sections were drawn again.
     */
    drawSections() {
        const frames = this.documentFrames();
        const key = JSON.stringify(
            frames.map(({index, id, title, notes}) => [index, id, title, notes])
        );
        if (key === this.drawn) {
            return false;
        }
        this.drawn = key;
        this.drawnFrames = frames;
        this.sections = frames
            .filter(({notes}) => !isBlankHTML(notes, this.doc))
            .map(frame => this.drawSection(frame));
        this.body.replaceChildren(...this.sections.map(({element}) => element));
        highlightCode(this.body);
        return true;
    }

    /** Draw a section: the frame's title as its heading, then its notes.
     *
     * @param {FrameInfo} frame - The frame.
     * @returns {DrawnSection} The section.
     */
    drawSection({index, title, notes}) {
        const element = this.doc.createElement("section");
        element.className = "sozi-notes__section";
        const heading = this.doc.createElement("h1");
        heading.textContent = title.trim() || UNTITLED;
        const content = this.doc.createElement("div");
        content.className = "sozi-notes__section-notes";
        setSanitizedHTML(content, notes);
        this.markLinks(content);
        element.append(heading, content);
        return {index, element, heading};
    }

    /** Mark a link to a missing frame as broken, and open any link off the deck in a new tab.
     *
     * @param {HTMLElement} content - The notes of a section, sanitized.
     */
    markLinks(content) {
        for (const link of content.querySelectorAll("a[href]")) {
            const target = linkTarget(link.getAttribute("href") || "", this.drawnFrames);
            if (target.kind === "broken") {
                link.classList.add("sozi-notes__link--broken");
                link.setAttribute("aria-disabled", "true");
                link.setAttribute("title", `No frame "${target.fragment}" in this deck`);
            } else if (target.kind === "external") {
                link.setAttribute("target", "_blank");
                link.setAttribute("rel", "noopener noreferrer");
            }
        }
    }

    /** Bring a section to the top of the document.
     *
     * @param {?DrawnSection} section - The section; null goes to the start of the document.
     */
    scrollToSection(section) {
        if (section) {
            const offset =
                section.heading.getBoundingClientRect().top - this.body.getBoundingClientRect().top;
            this.body.scrollTop += offset - TOP_GAP;
        } else {
            this.body.scrollTop = 0;
        }
    }

    /** Name the current frame above the document whenever its own heading is out of view. */
    showTitleLine() {
        const {frame} = this.mirror;
        if (!frame) {
            return;
        }
        this.title.textContent = frame.title;
        const own = this.ownSection();
        const box = this.body.getBoundingClientRect();
        const heading = own ? own.heading.getBoundingClientRect() : null;
        const inView = heading !== null && heading.bottom > box.top && heading.top < box.bottom;
        this.title.classList.toggle("sozi-notes-title--hidden", inView);
    }

    /** Pause the scrolling, or resume it at the current section.
     *
     * @param {boolean} following - Scroll with the talk?
     */
    setFollowing(following) {
        this.following = following;
        this.followButton.setAttribute("aria-pressed", String(following));
        if (following) {
            this.scrollToSection(coveringSection(this.sections, this.shownIndex));
        }
    }

    /** Change the font size, keep it for this device, and keep the same text in view.
     *
     * @param {number} step - How much to change it by.
     */
    changeFontSize(step) {
        const before = this.fontSize;
        this.fontSize = nextFontSize(before, step);
        this.storage.setItem(FONT_SIZE_KEY, String(this.fontSize));
        const position = this.body.scrollTop;
        this.showFontSize();
        this.body.scrollTop = (position * this.fontSize) / before;
    }

    /** Apply the font size to the document. */
    showFontSize() {
        this.body.style.setProperty("--sozi-notes-font-size", `${this.fontSize}px`);
    }

    /** A panel that comes back into view has lost its scroll: bring the section back. */
    onResize() {
        const {height} = this.body.getBoundingClientRect();
        if (this.scrollerHeight === 0 && height > 0 && this.following && this.mirror.frame) {
            this.scrollToSection(coveringSection(this.sections, this.shownIndex));
        }
        this.scrollerHeight = height;
        this.showTitleLine();
    }

    /** Fetch the notes file published beside a deck on http, once. No file changes nothing. */
    fetchPublished() {
        if (this.fetchStarted) {
            return;
        }
        this.fetchStarted = true;
        const url = notesUrl(this.deckHref());
        if (url === null) {
            return;
        }
        // Cast: an element in a page always has a window.
        const host = /** @type {Window} */ (this.doc.defaultView);
        host.fetch(url)
            .then(response => (response.ok ? response.text() : null))
            // A cross-origin deck without CORS can refuse: the deck's own notes stay.
            .catch(() => null)
            .then(text => {
                if (text !== null && !this.disposed) {
                    this.published = text;
                    this.update();
                }
            });
    }

    /** Stop following the display, remove the listeners and empty the element. */
    dispose() {
        this.disposed = true;
        this.mirror.off(DisplayMirrorEvents.change, this.onChange);
        this.body.removeEventListener("scroll", this.onScroll, false);
        this.body.removeEventListener("click", this.onClick, false);
        this.resizeObserver.disconnect();
        this.element.replaceChildren();
    }
}
