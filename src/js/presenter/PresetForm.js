/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {isPresetName} from "../protocol/layoutPresets.js";
import {matchForWidth, presetFileName, presetFileText, setCommand} from "./presets.js";

/** @typedef {import("../protocol/layoutPresets.js").PresetLayout} PresetLayout */

/** How long a download has to start before its URL goes away: some phones are slow to look.
 *
 * @readonly
 * @default
 * @type {number}
 */
const REVOKE_DELAY_MS = 40000;

/**
 * What a preset form saves, and whom it tells.
 *
 * @typedef {object} PresetFormOptions
 * @property {string} deckId - The deck's file name without `.sozi.html`.
 * @property {() => number} width - The page's width in CSS pixels.
 * @property {() => PresetLayout} layout - The current layout.
 * @property {(text: string) => void} onSaved - Called with what to do next.
 */

/** The form that saves the current layout as a preset: a name, a match, and a download.
 *
 * The display is a static page with no way to write the sozi.json, so the preset leaves as a
 * file, and the notice says what to run.
 */
export class PresetForm {
    /** Build the form, hidden.
     *
     * @param {Document} doc - The page the form is drawn in.
     * @param {any} host - Where `Blob`, `URL` and the timers come from: the window.
     * @param {PresetFormOptions} options - What it saves, and whom it tells.
     */
    constructor(doc, host, options) {
        this.doc = doc;
        this.host = host;
        this.options = options;

        /** The URL of each download that has not had its time yet, with its timer.
         *
         * @type {Map<string, any>}
         */
        this.downloads = new Map();

        this.element = doc.createElement("form");
        this.element.className = "sozi-preset-form";
        this.element.setAttribute("aria-label", "Save as preset");
        this.element.hidden = true;

        this.name = doc.createElement("input");
        this.name.type = "text";
        this.match = doc.createElement("select");
        for (const value of ["phone", "laptop"]) {
            const option = doc.createElement("option");
            option.value = value;
            option.textContent = value;
            this.match.append(option);
        }
        this.error = doc.createElement("p");
        this.error.className = "sozi-preset-form__error";
        this.error.setAttribute("role", "alert");

        const save = doc.createElement("button");
        save.type = "submit";
        save.textContent = "Save";
        this.cancel = doc.createElement("button");
        this.cancel.type = "button";
        this.cancel.textContent = "Cancel";
        const buttons = doc.createElement("div");
        buttons.className = "sozi-preset-form__buttons";
        buttons.append(save, this.cancel);

        this.element.append(
            this.labelled("Name", this.name),
            this.labelled("Match", this.match),
            this.error,
            buttons
        );

        this.onSubmit = evt => {
            evt.preventDefault();
            this.save();
        };
        this.onCancel = () => this.close();
        // The presenter's keys move the talk; here a space is part of a name.
        this.onKeyDown = evt => {
            evt.stopPropagation();
            if (evt.key === "Escape") {
                this.close();
            }
        };
        this.element.addEventListener("submit", this.onSubmit, false);
        this.element.addEventListener("keydown", this.onKeyDown, false);
        this.cancel.addEventListener("click", this.onCancel, false);
    }

    /** A field with its label around it.
     *
     * @param {string} text - The label's text.
     * @param {HTMLElement} field - The field.
     * @returns {HTMLElement} The label.
     */
    labelled(text, field) {
        const label = this.doc.createElement("label");
        label.className = "sozi-preset-form__field";
        label.append(text, field);
        return label;
    }

    /** Show the form, on the page's current width class. */
    open() {
        this.error.textContent = "";
        this.match.value = matchForWidth(this.options.width());
        this.element.hidden = false;
        this.name.focus();
    }

    /** Hide the form. */
    close() {
        this.element.hidden = true;
    }

    /** Download the preset and say what to do next, if its name is usable. */
    save() {
        const name = this.name.value.trim();
        if (!isPresetName(name)) {
            this.error.textContent =
                "A name starts with a letter and holds only letters, digits, - and _.";
            return;
        }
        const {deckId, layout, onSaved} = this.options;
        const fileName = presetFileName(deckId, name);
        this.download(
            fileName,
            presetFileText(/** @type {"phone" | "laptop"} */ (this.match.value), layout())
        );
        this.close();
        onSaved(
            `Saved ${fileName}. To put it in the deck, run ` +
                `${setCommand(deckId, name, fileName)}, then build the deck again.`
        );
    }

    /** Download a text file, and let its URL go once the download has had time to start.
     *
     * @param {string} fileName - The file's name.
     * @param {string} text - Its content.
     */
    download(fileName, text) {
        const {Blob, URL, setTimeout} = this.host;
        const url = URL.createObjectURL(new Blob([text], {type: "application/json"}));
        const anchor = this.doc.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        const timer = setTimeout(() => this.release(url), REVOKE_DELAY_MS);
        this.downloads.set(url, timer);
    }

    /** Revoke a download's URL.
     *
     * @param {string} url - The URL.
     */
    release(url) {
        this.host.clearTimeout(this.downloads.get(url));
        this.downloads.delete(url);
        this.host.URL.revokeObjectURL(url);
    }

    /** Remove the listeners, the waiting URLs and the form from the page. */
    dispose() {
        for (const url of [...this.downloads.keys()]) {
            this.release(url);
        }
        this.element.removeEventListener("submit", this.onSubmit, false);
        this.element.removeEventListener("keydown", this.onKeyDown, false);
        this.cancel.removeEventListener("click", this.onCancel, false);
        this.element.remove();
    }
}
