/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {presetChoices} from "./arrangement.js";
import {layoutSource, readSavedLayout, savedLayoutText} from "./layout.js";
import {pickPreset} from "./presets.js";

/** @typedef {import("../protocol/layoutPresets.js").LayoutPreset} LayoutPreset */
/** @typedef {import("./layout.js").SavedLayout} SavedLayout */

/**
 * What the chooser shows layouts on: the workspace, which alone drives the dock.
 *
 * @typedef {object} LayoutStage
 * @property {() => {id: string}[]} specs - Every panel's spec, in the order added.
 * @property {number} width - The page's width, in CSS pixels.
 * @property {import("../protocol/layoutPresets.js").PresetLayout} layout - The current layout,
 *   in its stored form.
 * @property {boolean} stacked - Is the page showing one stack of tabs?
 * @property {boolean} maximised - Does a panel fill the workspace?
 * @property {(layout: SavedLayout) => boolean} showLayout - Shows a layout; false if the dock
 *   refused it.
 * @property {() => void} showDefault - Shows the default dock.
 * @property {() => void} showStack - Shows every panel as one stack of tabs.
 */

/**
 * What a layout chooser is built with.
 *
 * @typedef {object} LayoutChooserOptions
 * @property {Storage} storage - Where the layouts are saved.
 * @property {{wide: string, narrow: string}} keys - The key of each width's layout in the
 *   storage.
 * @property {MediaQueryList} media - Matches while the page is narrow.
 * @property {(text: string) => void} onNotice - Says something to the speaker.
 */

/**
 * The id of every panel of a stage.
 *
 * @param {LayoutStage} stage - The stage.
 * @returns {string[]} The ids, in the order added.
 */
function panelIds(stage) {
    return stage.specs().map(spec => spec.id);
}

/** Which layout the workspace shows, and when the speaker's change to it is saved.
 *
 * A change the speaker makes is saved for the page's width, except while the page shows the
 * stack or a panel is maximised. Showing a preset by itself saves nothing, so a preset the deck
 * changes later still reaches this device; choosing one from the Layouts menu saves it. The
 * page opens on the layout saved for its width if the dock takes it, else on a preset, else on
 * the default dock or the stack.
 */
export class LayoutChooser {
    /** Build a chooser that shows layouts on a stage; it shows nothing until `open`.
     *
     * @param {LayoutStage} stage - What it shows layouts on.
     * @param {LayoutChooserOptions} options - Where the layouts are saved, the narrow query, and
     *   what it tells the speaker.
     */
    constructor(stage, {storage, keys, media, onNotice}) {
        this.stage = stage;
        this.storage = storage;
        this.keys = keys;
        this.media = media;
        this.onNotice = onNotice;

        /** Has `open` run? Nothing is saved or arranged before it.
         *
         * @type {boolean}
         */
        this.opened = false;

        /** The deck's layout presets, the latest the display reported.
         *
         * @type {Record<string, LayoutPreset>}
         */
        this.presets = {};

        /** Has a preset been offered yet? Only the first offer changes what is on the page.
         *
         * @type {boolean}
         */
        this.offered = false;

        /** Did the last `arrange` show the saved layout? Dockview can refuse one that reads well.
         *
         * @type {boolean}
         */
        this.savedShown = false;

        /** How many of the workspace's own changes to the dock are still being told; what
         * they fire is not the speaker's.
         *
         * @type {number}
         */
        this.arranging = 0;

        /** Is the page narrow? It picks the layout's slot in the storage.
         *
         * @type {boolean}
         */
        this.narrow = false;

        this.onMediaChange = (/** @type {MediaQueryListEvent} */ evt) =>
            this.setNarrow(evt.matches);
        media.addEventListener("change", this.onMediaChange);
    }

    /** Show what this width shows, and start saving; the stage holds its default dock. */
    open() {
        this.opened = true;
        this.narrow = this.media.matches;
        this.arrange(true);
    }

    /** Take the deck's presets; the first offer shows one, unless a saved layout is shown.
     *
     * The display can answer many times, and a talk must not rearrange itself when it does:
     * later presets wait for a reset, a move across the narrow width, or the Layouts menu.
     * Presets that come before `open` wait for it, as it shows them.
     *
     * @param {Record<string, LayoutPreset>} presets - The presets, in the deck's order.
     */
    offerPresets(presets) {
        this.presets = presets;
        if (!this.offered) {
            this.offered = true;
            // With no saved layout shown, the dock is the default, or the stack on a narrow page.
            if (this.opened && !this.savedShown) {
                this.arrange(true);
            }
        }
    }

    /** The names of the layouts the Layouts menu offers.
     *
     * @returns {string[]} The deck's presets for this width, then Default.
     */
    presetNames() {
        return presetChoices(this.presets, this.stage.width, panelIds(this.stage)).map(c => c.name);
    }

    /** Show a layout from the Layouts menu, and save it for this width.
     *
     * @param {string} name - A preset's name, or Default.
     */
    choosePreset(name) {
        const choice = presetChoices(this.presets, this.stage.width, panelIds(this.stage)).find(
            c => c.name === name
        );
        if (!choice) {
            return;
        }
        if (choice.layout && !this.stage.showLayout(choice.layout)) {
            this.onNotice(`This page cannot use the deck's layout: ${name}.`);
        } else if (!choice.layout) {
            this.stage.showDefault();
        }
        this.save();
    }

    /** Forget the layout saved for this width, and go back to the preset or the default. */
    reset() {
        this.storage.removeItem(this.slot);
        this.arrange();
    }

    /** The key of the layout saved for the page's width.
     *
     * @readonly
     * @type {string}
     */
    get slot() {
        return this.narrow ? this.keys.narrow : this.keys.wide;
    }

    /** Change the dock without what that fires counting as the speaker's change.
     *
     * Dockview tells its listeners in a microtask queued by the first change, so this one,
     * queued after them all, ends the guard once they have been told. Changes in one turn
     * overlap, so the guard lasts until the last of them ends. The guard ends even when the
     * change throws, and the error reaches the caller as it was thrown.
     *
     * @param {() => void} change - What changes the dock.
     */
    whileArranging(change) {
        this.arranging++;
        try {
            change();
        } finally {
            queueMicrotask(() => this.arranging--);
        }
    }

    /** Show what the page's width shows, by `layoutSource`, and note if it was the saved one.
     *
     * @param {boolean} [atDefault] - Is the dock still as the panels built it?
     */
    arrange(atDefault = false) {
        this.whileArranging(() => {
            const text = this.storage.getItem(this.slot);
            const saved = text === null ? null : readSavedLayout(text, panelIds(this.stage));
            this.savedShown = saved !== null && this.stage.showLayout(saved);
            const presetShown = !this.savedShown && this.showPreset();
            const source = layoutSource({
                narrow: this.narrow,
                saved: this.savedShown,
                preset: presetShown
            });
            if (source === "stack") {
                this.stage.showStack();
            } else if (source === "default" && !atDefault) {
                this.stage.showDefault();
            }
        });
    }

    /** Show the first preset of the deck this page can use, and name those it cannot.
     *
     * @returns {boolean} True if a preset is shown.
     */
    showPreset() {
        const ids = panelIds(this.stage);
        const {width} = this.stage;
        /** @type {string[]} */
        const failed = [];
        let pick = pickPreset(this.presets, width, ids);
        const {refused} = pick;
        while (pick.layout && !this.stage.showLayout(pick.layout)) {
            failed.push(/** @type {string} */ (pick.name));
            pick = pickPreset(this.presets, width, ids, failed);
        }
        const unusable = [...new Set([...refused, ...pick.refused, ...failed])];
        if (unusable.length) {
            this.onNotice(`This page cannot use the deck's layout: ${unusable.join(", ")}.`);
        }
        return pick.layout !== null;
    }

    /** Save the layout for the page's width, unless the speaker did not change it. */
    save() {
        const noChange = !this.opened || this.arranging > 0 || this.stage.stacked;
        if (noChange || this.stage.maximised) {
            return;
        }
        const {dock, rail} = this.stage.layout;
        this.storage.setItem(this.slot, savedLayoutText(dock, rail));
    }

    /** Take the page's width class, and show what that width shows.
     *
     * @param {boolean} narrow - Is the page narrow now?
     */
    setNarrow(narrow) {
        if (narrow === this.narrow || !this.opened) {
            return;
        }
        this.narrow = narrow;
        this.arrange();
    }

    /** Stop following the page's width. */
    dispose() {
        this.media.removeEventListener("change", this.onMediaChange);
    }
}
