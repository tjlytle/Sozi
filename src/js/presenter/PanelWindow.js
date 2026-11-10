/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

/**
 * What a panel's window is built with.
 *
 * @typedef {object} PanelWindowOptions
 * @property {string} id - The panel's id, which names the window.
 * @property {string} title - The panel's title, the window's title.
 * @property {{left: number, top: number, width: number, height: number}} box - Where the
 *   panel is on the page, which the window starts at.
 * @property {(root: HTMLElement) => any} buildDock - Builds a dock in an element of the
 *   window, with the panel in it, and returns it.
 * @property {() => void} onClose - Called when the window closes by itself or by the speaker.
 */

/** A panel in a window of its own, in a dock of its own.
 *
 * The window opens on `about:blank`, which a page on `file:` or `http:` alike can script, and
 * takes the page's styles. Dockview's own popouts load a page from the deck's origin, which a
 * deck opened from a file does not have.
 */
export class PanelWindow {
    /** Prepare the window; `open` opens it.
     *
     * @param {Window} view - The presenter page's window.
     * @param {PanelWindowOptions} options - The panel, and what to do when its window goes.
     */
    constructor(view, {id, title, box, buildDock, onClose}) {
        this.view = view;
        this.id = id;
        this.title = title;
        this.box = box;
        this.buildDock = buildDock;

        /** The window, null until it opens and once it is closed.
         *
         * @type {?Window}
         */
        this.window = null;

        /** The dock in the window.
         *
         * @type {any}
         */
        this.dock = null;

        this.onResize = () => this.layout();
        this.onPageHide = () => {
            this.dispose();
            onClose();
        };
        // A presenter page that goes away takes its panels' windows with it.
        this.onOpenerHide = () => this.dispose();
    }

    /** Open the window and draw the panel in it.
     *
     * @returns {boolean} False if the browser blocked the window.
     */
    open() {
        const {left, top, width, height} = this.box;
        const x = this.view.screenX + left;
        const y = this.view.screenY + top;
        const features = `popup,left=${x},top=${y},width=${width},height=${height}`;
        const target = this.view.open("", `sozi-panel ${this.id}`, features);
        if (!target) {
            return false;
        }
        this.window = target;
        const doc = target.document;
        doc.title = this.title;
        for (const sheet of this.view.document.styleSheets) {
            const style = doc.createElement("style");
            style.textContent = [...sheet.cssRules].map(rule => rule.cssText).join("\n");
            doc.head.append(style);
        }
        const root = doc.createElement("div");
        root.className = "sozi-dock sozi-dock--window";
        // A window this page opened before, under this name, may still hold an old dock.
        doc.body.replaceChildren(root);
        this.dock = this.buildDock(root);
        this.layout();
        target.addEventListener("resize", this.onResize);
        target.addEventListener("pagehide", this.onPageHide);
        this.view.addEventListener("pagehide", this.onOpenerHide);
        return true;
    }

    /** Fit the dock to the window. */
    layout() {
        if (this.window && this.dock) {
            this.dock.layout(this.window.innerWidth, this.window.innerHeight);
        }
    }

    /** Close the window without telling the workspace, and remove the dock and listeners. */
    dispose() {
        const target = this.window;
        this.window = null;
        this.view.removeEventListener("pagehide", this.onOpenerHide);
        if (target) {
            target.removeEventListener("resize", this.onResize);
            target.removeEventListener("pagehide", this.onPageHide);
            target.close();
        }
        if (this.dock) {
            this.dock.dispose();
        }
        this.dock = null;
    }
}
