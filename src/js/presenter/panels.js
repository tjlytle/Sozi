/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** What `sozi.presenter.registerPanel` accepts, read into what the workspace adds.
 *
 * @module
 */

/** @typedef {import("./Workspace.js").PanelSpec} PanelSpec */

/**
 * What a panel's `render` is given besides its element: a way to ask the workspace for what
 * the panel's ⋯ menu does.
 *
 * @typedef {object} PanelHandle
 * @property {() => void} maximise - Fill the workspace with the panel, or bring the layout
 *   back if a panel fills it.
 * @property {boolean} maximised - Does a panel fill the workspace?
 * @property {(listener: () => void) => () => void} onMaximisedChange - Calls the listener each
 *   time a panel fills the workspace or stops filling it; gives the function that stops it.
 */

/**
 * What an add-on, or the presenter itself, registers.
 *
 * @typedef {object} PanelDefinition
 * @property {string} id - Its id, which the saved layout names.
 * @property {string} title - The title of its tab.
 * @property {string} [icon] - The glyph before its title in the menus; by default, the
 *   title's first letter.
 * @property {string} [description] - One line that says what it is, under its title in the +
 *   menu; empty by default.
 * @property {(element: HTMLElement, handle: PanelHandle) => (void | (() => void))} [render] -
 *   Draws the panel; may return the function that cleans it up.
 * @property {string} [url] - The page to embed instead: exactly one of `render` or `url`.
 * @property {{position?: object, inactive?: boolean, initialHeight?: number}} [defaults] -
 *   Its place in the default layout, as a `PanelSpec` has it.
 */

/** The place of a panel that names none: a tab behind Notes, so that it covers nothing.
 *
 * @readonly
 */
const DEFAULT_PLACE = Object.freeze({
    position: Object.freeze({referencePanel: "notes", direction: "within"}),
    inactive: true
});

/** The schemes a url panel may show: a relative URL resolves against this base's.
 *
 * @readonly
 */
const URL_SCHEMES = Object.freeze(["http:", "https:"]);

/** A base for parsing a URL only to find its scheme.
 *
 * @readonly
 * @default
 * @type {string}
 */
const RELATIVE_BASE = "http://relative.invalid/";

/**
 * Does nothing: the cleanup of a panel that left nothing to clean up.
 */
function noCleanup() {}

/**
 * Keep an add-on's render from stopping the panels that come after it.
 *
 * @param {(element: HTMLElement, handle: PanelHandle) => any} render - The panel's render.
 * @param {string} title - The panel's title.
 * @returns {(element: HTMLElement, handle: PanelHandle) => () => void} A render that always
 *   gives a cleanup, and hands the panel's handle on.
 */
function safeRender(render, title) {
    return (element, handle) => {
        try {
            const cleanup = render(element, handle);
            return typeof cleanup === "function" ? cleanup : noCleanup;
        } catch (err) {
            // The speaker sees which panel failed; the stack is for the add-on's author.
            element.textContent = `The panel "${title}" failed: ${/** @type {any} */ (err).message}`;
            console.error(err);
            return noCleanup;
        }
    };
}

/**
 * The render of a panel that embeds a page.
 *
 * @param {string} url - The page: `http:`, `https:` or relative. `javascript:` is refused,
 *   since the iframe has no `sandbox`.
 * @param {string} title - The iframe's accessible name.
 * @returns {(element: HTMLElement) => () => void} The render.
 * @throws {TypeError} If the URL has any other scheme.
 */
export function urlPanelRender(url, title) {
    const {protocol} = new URL(url, RELATIVE_BASE);
    if (!URL_SCHEMES.includes(protocol)) {
        throw new TypeError(`A panel's url must be http, https or relative: ${url}`);
    }
    return element => {
        const iframe = element.ownerDocument.createElement("iframe");
        iframe.className = "sozi-url-panel";
        iframe.src = url;
        iframe.title = title;
        element.append(iframe);
        return () => iframe.remove();
    };
}

/**
 * Read a panel definition.
 *
 * @param {PanelDefinition} def - The definition.
 * @returns {PanelSpec} What the workspace adds.
 * @throws {TypeError} Naming the field that is missing or not valid.
 */
export function readPanel(def) {
    const {id, title, icon, description, render, url, defaults = DEFAULT_PLACE} = def || {};
    if (typeof id !== "string" || !id) {
        throw new TypeError("A panel needs an id");
    }
    if (typeof title !== "string" || !title) {
        throw new TypeError(`Panel "${id}" needs a title`);
    }
    if (icon !== undefined && typeof icon !== "string") {
        throw new TypeError(`Panel "${id}": icon must be a string`);
    }
    if (
        description !== undefined &&
        (typeof description !== "string" || /[\r\n]/.test(description))
    ) {
        throw new TypeError(`Panel "${id}": description must be a string of one line`);
    }
    if ((render === undefined) === (url === undefined)) {
        throw new TypeError(`Panel "${id}" needs exactly one of render or url`);
    }
    if (render !== undefined && typeof render !== "function") {
        throw new TypeError(`Panel "${id}": render must be a function`);
    }
    if (url !== undefined && typeof url !== "string") {
        throw new TypeError(`Panel "${id}": url must be a string`);
    }
    return {
        ...defaults,
        id,
        title,
        icon: icon === undefined ? title.charAt(0) : icon,
        description: description === undefined ? "" : description,
        // Cast: with no render, the check above has found a url.
        render: safeRender(render || urlPanelRender(/** @type {string} */ (url), title), title)
    };
}
