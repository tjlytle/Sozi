/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The `set` command of `sozi --cli`.
 *
 * Changes properties of a presentation and writes the presentation JSON file.
 * Writes no HTML file.
 *
 * @module
 */

/** The options of this command, with the presentation property each one sets.
 *
 * `kind` is the entry of the option in the flag table
 * (see {@link module:cli/args.GLOBAL_FLAGS}).
 *
 * @type {{[option: string]: {property: string, kind: (boolean|string)}}}
 */
export const OPTIONS = {
    title: {property: "explicitTitle", kind: "maybe-empty"}
};

/** The flags of this command (see {@link module:cli/args.GLOBAL_FLAGS}).
 *
 * @type {{[name: string]: (boolean|string)}}
 */
export const FLAGS = Object.fromEntries(Object.entries(OPTIONS).map(([option, {kind}]) => [option, kind]));

/** Check that the command line gives at least one property to set.
 *
 * @param {object} flags - The command-line flags.
 * @returns {?string} - An error message, or `null` if the flags are valid.
 */
export function checkFlags(flags) {
    if (Object.keys(OPTIONS).some(option => Object.hasOwn(flags, option))) {
        return null;
    }
    return "no property to set; use " + Object.keys(OPTIONS).map(option => `--${option}`).join(", ");
}

/** Apply the options of {@link OPTIONS} found in the flags to the presentation.
 *
 * Each property is set through the controller, which marks the presentation
 * JSON as needing to be saved. A property that already has the given value
 * is left alone.
 *
 * @param {module:Controller.Controller} controller - The controller.
 * @param {object} flags - The command-line flags.
 * @returns {{[option: string]: {from: any, to: any}}} - The changed options, with their old and new values.
 */
export function applyOptions(controller, flags) {
    const changed = {};
    for (const [option, {property}] of Object.entries(OPTIONS)) {
        if (!Object.hasOwn(flags, option)) {
            continue;
        }
        const from = controller.presentation[property];
        const to   = flags[option];
        if (from !== to) {
            controller.setPresentationProperty(property, to);
            changed[option] = {from, to};
        }
    }
    return changed;
}

/** Set properties of a presentation that has been loaded and write its JSON file.
 *
 * The JSON file is written if a property changed, if the file does not exist,
 * or if the presentation was changed while loading (`storage.jsonNeedsSaving`).
 *
 * @param {object} context - The command context.
 * @param {module:Controller.Controller} context.controller - The controller.
 * @param {module:Storage.Storage} context.storage - The storage, with the presentation loaded.
 * @param {string} context.presentation - The absolute path of the JSON file.
 * @param {object} context.flags - The command-line flags.
 * @returns {{ok: boolean, changed: object, files: string[]}} - The command result.
 */
export function set({controller, storage, presentation, flags}) {
    const fs = require("fs");

    const changed = applyOptions(controller, flags);
    const files = [];
    if (!fs.existsSync(presentation) || storage.jsonNeedsSaving) {
        fs.writeFileSync(presentation, storage.getJSONData(), {encoding: "utf-8"});
        files.push(presentation);
    }

    return {ok: true, changed, files};
}
