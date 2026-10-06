/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Renderer side of `sozi --cli`.
 *
 * The main process passes the parsed command line as a `--sozi-cli=<json>`
 * argument of the renderer process. Results go back to the main process
 * through IPC, which prints them and exits.
 *
 * Node modules are required lazily so that this module stays harmless in
 * the browser build of the editor.
 *
 * @module
 */

import {build, FLAGS as buildFlags} from "./commands/build";
import {exportPresentation, FLAGS as exportFlags, checkFlags as checkExportFlags} from "./commands/export";
import {inspect, FLAGS as inspectFlags} from "./commands/inspect";
import {render, FLAGS as renderFlags, checkFlags as checkRenderFlags} from "./commands/render";
import {set, FLAGS as setFlags, checkFlags as checkSetFlags} from "./commands/set";
import {validateArgs} from "./args";
import {isPresentationFile, presentationDataError, presentationFiles, svgOfPresentation} from "../naming";

const CLI_PREFIX = "--sozi-cli=";

const USAGE = "sozi --cli <inspect|build|set|render|export> [options] <file.svg|file.sozi.json>";

/** The available commands.
 *
 * A command receives a context `{controller, storage, svg, presentation, svgSource, cwd, flags, warnings}`
 * once the presentation is loaded, and returns a result object with an `ok` property.
 * A failed result may have an `exitCode` (default 1), which is not printed.
 *
 * @type {{[name: string]: Function}}
 */
const COMMANDS = {build, inspect, set, render, export: exportPresentation};

/** The flag table of each command, used to parse and validate the command line.
 *
 * @type {{[name: string]: {[flag: string]: (boolean|string)}}}
 */
export const COMMAND_FLAGS = {build: buildFlags, inspect: inspectFlags, set: setFlags, render: renderFlags, export: exportFlags};

/** Command-specific checks of the flags, run before the presentation is loaded.
 *
 * A check returns an error message for a usage error, or `null`.
 *
 * @type {{[name: string]: Function}}
 */
const FLAG_CHECKS = {set: checkSetFlags, render: checkRenderFlags, export: checkExportFlags};

/** Has a result been sent to the main process?
 *
 * @type {boolean}
 */
let replied = false;

/** The fields of the result known so far, reported by the global error handlers.
 *
 * @type {object}
 */
let partialResult = {};

/** Get the CLI options passed by the main process.
 *
 * @returns {?object} - The parsed command line and `cwd`, or `null` in GUI mode.
 */
export function getCliOptions() {
    if (typeof process === "undefined" || !Array.isArray(process.argv)) {
        return null;
    }
    const arg = process.argv.find(a => a.startsWith(CLI_PREFIX));
    return arg ? JSON.parse(arg.slice(CLI_PREFIX.length)) : null;
}

/** Send the result of the command to the main process, which exits.
 *
 * Only the first call has an effect.
 *
 * @param {number} code - The exit code.
 * @param {object} result - The JSON document to print on stdout.
 */
function reply(code, result) {
    if (replied) {
        return;
    }
    replied = true;
    const {ipcRenderer} = require("electron");
    ipcRenderer.send("sozi-cli:result", {code, json: JSON.stringify(result)});
}

/** Send a line to the standard error of the main process.
 *
 * @param {string} line - The text to log.
 */
function log(line) {
    const {ipcRenderer} = require("electron");
    ipcRenderer.send("sozi-cli:log", line);
}

/** Fail with exit code 1 on any uncaught error in the renderer.
 *
 * Call this as early as possible in command-line mode so that a failure
 * never leaves the process running without a result.
 */
export function catchCliErrors() {
    const options = getCliOptions();
    partialResult = {command: options ? options.command : null, svg: null, presentation: null, warnings: [], errors: []};
    const fail = err => reply(1, Object.assign({}, partialResult, {ok: false, error: String(err), stack: err && err.stack}));
    window.addEventListener("error", evt => fail(evt.error || evt.message));
    window.addEventListener("unhandledrejection", evt => fail(evt.reason));
}

/** Find the SVG and presentation files of the command line.
 *
 * The file argument is a presentation file if its name ends in `.sozi.json`,
 * else an SVG file; another `.json` file is an error. With an SVG file,
 * `--presentation` names the presentation file; it is created by the commands
 * that write if needed.
 *
 * @param {string} file - The absolute path of the file argument.
 * @param {object} options - The value returned by {@link getCliOptions}.
 * @returns {{result: {svg: ?string, presentation: ?string}, svgSource: string, code: number, error: ?string}} -
 *  The file paths, how the SVG file was found (`"default"`, `"json"` for the `svg` key, `"flag"` for `--presentation`),
 *  and an exit code with an error message, or code 0.
 */
function resolveFiles(file, options) {
    const fs   = require("fs");
    const path = require("path");

    const flag   = options.flags.presentation;
    const result = {svg: null, presentation: null};
    const fail   = (code, error) => ({result, svgSource: null, code, error});

    if (/\.json$/i.test(file) && !isPresentationFile(file)) {
        return fail(1, `not a presentation file: ${file}: the name does not end in .sozi.json`);
    }

    if (isPresentationFile(file)) {
        result.presentation = file;
        if (flag !== undefined) {
            return fail(2, `--presentation needs an SVG file argument, not a presentation file: ${file}`);
        }
        if (!fs.existsSync(file)) {
            return fail(1, `file not found: ${file}`);
        }
        const text   = fs.readFileSync(file, {encoding: "utf-8"});
        const reason = presentationDataError(text);
        if (reason) {
            return fail(1, `not a presentation file: ${file}: ${reason}`);
        }
        let svgKey = JSON.parse(text).svg;
        // A non-string key is ignored, with a warning once the presentation is loaded.
        svgKey = typeof svgKey === "string" ? svgKey : "";
        result.svg = svgOfPresentation(file, svgKey);
        if (!fs.existsSync(result.svg)) {
            return fail(1, `SVG file not found: ${result.svg} (` +
                (svgKey ? `from the "svg" key of ${file})` : `${file} has no "svg" key; add one to name the SVG file)`));
        }
        return {result, svgSource: svgKey ? "json" : "default", code: 0, error: null};
    }

    result.svg = file;
    if (flag !== undefined) {
        result.presentation = path.resolve(options.cwd, flag);
        if (!isPresentationFile(result.presentation)) {
            return fail(2, `--presentation must name a .sozi.json file, e.g. talk.sozi.json: ${result.presentation}`);
        }
        if (fs.existsSync(result.presentation) && fs.statSync(result.presentation).isDirectory()) {
            return fail(2, `--presentation is a directory: ${result.presentation}`);
        }
    }
    else {
        result.presentation = presentationFiles(file).presentation;
        if (result.presentation === file) {
            return fail(2, `file has no extension: ${file}`);
        }
    }
    if (!fs.existsSync(file)) {
        return fail(1, `file not found: ${file}`);
    }
    return {result, svgSource: flag !== undefined ? "flag" : "default", code: 0, error: null};
}

/** Run a CLI command in the renderer.
 *
 * @param {object} options - The value returned by {@link getCliOptions}.
 * @param {object} editor - The editor objects.
 * @param {module:Controller.Controller} editor.controller - The controller.
 * @param {module:Storage.Storage} editor.storage - The storage, already activated.
 * @param {module:model/Preferences.Preferences} editor.preferences - The user preferences.
 * @returns {Promise} - A promise resolved when the result has been sent.
 */
export async function runCli(options, {controller, storage, preferences}) {
    const path = require("path");

    const warnings = [];
    const errors   = [];
    const result   = partialResult = {command: options.command, svg: null, presentation: null, warnings, errors};

    try {
        // In-memory settings only: preferences are never saved in CLI mode.
        // Messages are in English so that errors and warnings are stable.
        preferences.animateTransitions = false;
        preferences.saveMode           = "manual";
        preferences.reloadMode         = "manual";
        preferences.language           = "en";
        controller.applyPreferences({language: true});

        // Test hook: never reply, so that the main process times out.
        if (process.env.SOZI_CLI_TEST_HANG) {
            return;
        }

        controller.info = body => {
            warnings.push(body);
            log(`info: ${body}`);
        };
        controller.error = body => {
            errors.push(body);
            log(`error: ${body}`);
        };

        const command = Object.hasOwn(COMMANDS, options.command) ? COMMANDS[options.command] : null;
        if (!command) {
            reply(2, Object.assign(result, {ok: false, error: `unknown command: ${options.command}`, usage: USAGE}));
            return;
        }

        const usageError = validateArgs(options, COMMAND_FLAGS) ||
            (Object.hasOwn(FLAG_CHECKS, options.command) ? FLAG_CHECKS[options.command](options.flags) : null);
        if (usageError) {
            reply(2, Object.assign(result, {ok: false, error: usageError, usage: USAGE}));
            return;
        }

        const file = options.positionals[0];
        if (!file) {
            reply(2, Object.assign(result, {ok: false, error: "missing file argument"}));
            return;
        }

        const files = resolveFiles(path.resolve(options.cwd, file), options);
        Object.assign(result, files.result);
        if (files.code) {
            reply(files.code, Object.assign(result, {ok: false, error: files.error}));
            return;
        }

        const backend = storage.backends.find(b => b.constructor.name === "Electron");
        storage.writeOnOpen = false;
        await storage.setSVGFile(result.svg, backend, {name: path.basename(result.presentation), location: path.dirname(result.presentation)});
        if (storage.jsonLoadError) {
            const message = storage.jsonLoadError.message || String(storage.jsonLoadError);
            reply(1, Object.assign(result, {ok: false, error: `presentation JSON could not be parsed: ${result.presentation}: ${message}`}));
            return;
        }
        if (errors.length) {
            reply(1, Object.assign(result, {ok: false, error: errors[0]}));
            return;
        }
        for (const key of controller.presentation.ignoredStorableKeys || []) {
            warnings.push(`ignored non-string ${key} in ${result.presentation}`);
        }

        const commandResult = await command({
            controller,
            storage,
            svg:          result.svg,
            presentation: result.presentation,
            svgSource:    files.svgSource,
            cwd:          options.cwd,
            flags:        options.flags,
            warnings
        });
        const exitCode = commandResult.exitCode || 1;
        delete commandResult.exitCode;
        Object.assign(result, commandResult);
        if (errors.length) {
            result.ok = false;
            result.error = errors[0];
        }
        reply(result.ok ? 0 : exitCode, result);
    }
    catch (err) {
        reply(1, Object.assign(result, {ok: false, error: String(err), stack: err && err.stack}));
    }
}
