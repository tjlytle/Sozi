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

/** Find why a directory cannot be the output directory of the HTML files.
 *
 * The directory may not exist yet (it is created by `build`), but neither it
 * nor any of its existing ancestors may be something else than a directory.
 *
 * @param {string} dir - The absolute path of the directory.
 * @returns {?string} - The path that is not a directory, or `null` if the directory is usable.
 */
export function outputDirError(dir) {
    const fs   = require("fs");
    const path = require("path");

    for (let p = dir; ; p = path.dirname(p)) {
        if (fs.existsSync(p)) {
            return fs.statSync(p).isDirectory() ? null : p;
        }
        if (path.dirname(p) === p) {
            return null;
        }
    }
}

/** Convert the value of `--out-dir` to the `outputDir` key of a presentation file.
 *
 * The flag is a path relative to the working directory; the key is relative
 * to the directory of the presentation file, with forward slashes.
 * An empty value, or the directory of the presentation file, gives `""`.
 *
 * @param {string} value - The flag value.
 * @param {object} context - The command context.
 * @param {string} context.cwd - The working directory.
 * @param {string} context.presentation - The absolute path of the JSON file.
 * @returns {string} - The value of the key.
 */
function outputDirKey(value, {cwd, presentation}) {
    const path = require("path");

    if (!value) {
        return "";
    }
    return path.relative(path.dirname(presentation), path.resolve(cwd, value)).split(path.sep).join("/");
}

/** Check the value of `--out-dir` (see {@link outputDirError}).
 *
 * @param {string} value - The flag value.
 * @param {object} context - The command context.
 * @param {string} context.cwd - The working directory.
 * @returns {?string} - An error message, or `null`.
 */
function checkOutputDir(value, {cwd}) {
    const path = require("path");

    const bad = value ? outputDirError(path.resolve(cwd, value)) : null;
    return bad ? `--out-dir ${value}: ${bad} is not a directory` : null;
}

/** The options of this command, with the presentation property each one sets.
 *
 * `kind` is the entry of the option in the flag table
 * (see {@link module:cli/args.GLOBAL_FLAGS}).
 * `value(flag, context)`, if any, converts the trimmed flag value to the property value;
 * `check(flag, context)`, if any, returns a usage error for the flag value, or `null`.
 * `build: false` marks an option that `build` uses for one run without storing it.
 *
 * @type {{[option: string]: {property: string, kind: (boolean|string), value: ?Function, check: ?Function, build: ?boolean}}}
 */
export const OPTIONS = {
    title:     {property: "explicitTitle", kind: "maybe-empty"},
    "out-dir": {property: "outputDir", kind: "maybe-empty", value: outputDirKey, check: checkOutputDir, build: false}
};

/** The options of {@link OPTIONS} that `build` stores in the presentation.
 *
 * @type {{[option: string]: object}}
 */
export const BUILD_OPTIONS = Object.fromEntries(Object.entries(OPTIONS).filter(([, {build}]) => build !== false));

/** The flags of this command (see {@link module:cli/args.GLOBAL_FLAGS}):
 * the options and `--presentation`, which names the presentation file.
 *
 * @type {{[name: string]: (boolean|string)}}
 */
export const FLAGS = Object.assign(
    Object.fromEntries(Object.entries(OPTIONS).map(([option, {kind}]) => [option, kind])),
    {presentation: true}
);

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

/** Check the values of the options found in the flags (see {@link OPTIONS}).
 *
 * @param {object} flags - The command-line flags.
 * @param {object} context - The command context.
 * @param {object} [options] - The option table (default {@link OPTIONS}).
 * @returns {?string} - A usage error, or `null`.
 */
export function checkOptions(flags, context, options = OPTIONS) {
    for (const [option, {check}] of Object.entries(options)) {
        const error = check && Object.hasOwn(flags, option) ? check(flags[option].trim(), context) : null;
        if (error) {
            return error;
        }
    }
    return null;
}

/** Apply the options of {@link OPTIONS} found in the flags to the presentation.
 *
 * String values are trimmed, then converted by the `value` function of the
 * option, if any. Each property is set through the controller,
 * which marks the presentation JSON as needing to be saved. A property that
 * already has the given value is left alone.
 *
 * @param {module:Controller.Controller} controller - The controller.
 * @param {object} flags - The command-line flags.
 * @param {object} context - The command context, passed to the `value` functions.
 * @param {object} [options] - The option table (default {@link OPTIONS}).
 * @returns {{[option: string]: {from: any, to: any}}} - The changed options, with their old and new values.
 */
export function applyOptions(controller, flags, context, options = OPTIONS) {
    const changed = {};
    for (const [option, {property, value}] of Object.entries(options)) {
        if (!Object.hasOwn(flags, option)) {
            continue;
        }
        const from = controller.presentation[property];
        let to     = typeof flags[option] === "string" ? flags[option].trim() : flags[option];
        if (value) {
            to = value(to, context);
        }
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
 * @param {string} context.cwd - The working directory.
 * @param {object} context.flags - The command-line flags.
 * @returns {{ok: boolean, changed: object, files: string[]}} - The command result,
 *  or `{ok: false, error, exitCode: 2}` for an invalid option value.
 */
export function set(context) {
    const fs = require("fs");
    const {controller, storage, presentation, flags} = context;

    const error = checkOptions(flags, context);
    if (error) {
        return {ok: false, error, exitCode: 2};
    }
    const changed = applyOptions(controller, flags, context);
    const files = [];
    if (!fs.existsSync(presentation) || storage.jsonNeedsSaving) {
        fs.writeFileSync(presentation, storage.getJSONData(), {encoding: "utf-8"});
        files.push(presentation);
    }

    return {ok: true, changed, files};
}
