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

const CLI_PREFIX = "--sozi-cli=";

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
 * @param {number} code - The exit code.
 * @param {object} result - The JSON document to print on stdout.
 */
function reply(code, result) {
    const {ipcRenderer} = require("electron");
    ipcRenderer.send("sozi-cli:result", {code, json: JSON.stringify(result)});
}

/** Run a CLI command in the renderer.
 *
 * @param {object} options - The value returned by {@link getCliOptions}.
 */
export function runCli(options) {
    const fs = require("fs");
    const path = require("path");

    const file = options.positionals[0];
    if (!file) {
        reply(2, {ok: false, error: "missing file argument"});
        return;
    }

    const svgPath = path.resolve(options.cwd, file);
    if (!fs.existsSync(svgPath)) {
        reply(1, {ok: false, error: `file not found: ${svgPath}`});
        return;
    }

    reply(1, {ok: false, error: `command not implemented: ${options.command}`});
}
