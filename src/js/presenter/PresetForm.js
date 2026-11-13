/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {isPresetName} from "../protocol/layoutPresets.js";
import {matchForWidth, presetFileName, presetFileText, setCommand} from "./presets.js";
import {Downloads} from "./Downloads.js";

/** @typedef {import("../protocol/layoutPresets.js").PresetLayout} PresetLayout */

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
        this.options = options;

        /** Where the preset file is saved from.
         *
         * @type {Downloads}
         */
        this.downloads = new Downloads(doc, host);

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
        this.downloads.download(
            fileName,
            presetFileText(/** @type {"phone" | "laptop"} */ (this.match.value), layout()),
            "application/json"
        );
        this.close();
        onSaved(
            `Saved ${fileName}. To put it in the deck, run ` +
                `${setCommand(deckId, name, fileName)}, then build the deck again.`
        );
    }

    /** Remove the listeners, the waiting URLs and the form from the page. */
    dispose() {
        this.downloads.dispose();
        this.element.removeEventListener("submit", this.onSubmit, false);
        this.element.removeEventListener("keydown", this.onKeyDown, false);
        this.cancel.removeEventListener("click", this.onCancel, false);
        this.element.remove();
    }
}
