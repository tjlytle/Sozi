/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Command-line argument parsing for `sozi --cli`.
 *
 * This module has no dependencies so that it can be loaded in the
 * Electron main process and directly by the tests.
 *
 * @module
 */

/** Electron/Chromium switches that may appear anywhere and are not ours.
 *
 * @type {Set<string>}
 */
const CHROMIUM_SWITCHES = new Set([
    "--no-sandbox",
    "--disable-gpu",
    "--disable-gpu-sandbox",
    "--disable-dev-shm-usage",
    "--disable-software-rasterizer",
    "--enable-logging",
    "--in-process-gpu",
    "--use-gl",
    "--ozone-platform",
    "--enable-features",
    "--disable-features"
]);

/** The flags that every command accepts.
 *
 * A flag table maps a flag name to `true` if the flag takes a value,
 * `false` if it is boolean.
 *
 * @type {{[name: string]: boolean}}
 */
export const GLOBAL_FLAGS = {help: false, size: true, timeout: true};

/** Get the flag table of a command, including the global flags.
 *
 * @param {{[command: string]: object}} commandFlags - The flag table of each command.
 * @param {?string} command - The command name.
 * @returns {{[name: string]: boolean}} - The flags allowed for this command.
 */
function flagsOf(commandFlags, command) {
    return Object.assign({}, commandFlags[command], GLOBAL_FLAGS);
}

/** Parse the command line of the Electron main process.
 *
 * Everything up to and including `--cli` is skipped (Electron binary, app
 * path, Chromium switches). After `--cli`, the first non-flag argument is the
 * command; other non-flag arguments are positionals. Flags are
 * `--name=value`, `--name value` for the flags that take a value in the
 * table of the command, or boolean. Unknown flags are boolean: they are
 * reported by {@link validateArgs}. A value-taking flag that has no value
 * is `true`.
 *
 * @param {string[]} argv - The process arguments, e.g. `process.argv`.
 * @param {{[command: string]: object}} [commandFlags] - The flag table of each command (see {@link GLOBAL_FLAGS}).
 * @returns {{cli: boolean, command: ?string, positionals: string[], flags: object}} - The parsed arguments.
 */
export function parseArgs(argv, commandFlags = {}) {
    const result = {cli: false, command: null, positionals: [], flags: {}};
    const cliIndex = argv.indexOf("--cli");
    if (cliIndex < 0) {
        return result;
    }
    result.cli = true;

    const args = argv.slice(cliIndex + 1).filter(arg => !CHROMIUM_SWITCHES.has(arg.split("=")[0]));
    for (let i = 0; i < args.length; i ++) {
        const arg = args[i];
        if (arg.startsWith("--")) {
            const eq = arg.indexOf("=");
            if (eq >= 0) {
                result.flags[arg.slice(2, eq)] = arg.slice(eq + 1);
                continue;
            }
            const name = arg.slice(2);
            const next = args[i + 1];
            if (!flagsOf(commandFlags, result.command)[name] || next === undefined || next.startsWith("--")) {
                result.flags[name] = true;
            }
            else {
                result.flags[name] = next;
                i ++;
            }
        }
        else if (result.command === null) {
            result.command = arg;
        }
        else {
            result.positionals.push(arg);
        }
    }
    return result;
}

/** Check the flags and positionals of a parsed command line.
 *
 * The command itself and the presence of the file argument are not checked.
 *
 * @param {{command: ?string, positionals: string[], flags: object}} parsed - The result of {@link parseArgs}.
 * @param {{[command: string]: object}} commandFlags - The flag table of each command.
 * @returns {?string} - An error message, or `null` if the command line is valid.
 */
export function validateArgs(parsed, commandFlags) {
    const allowed = flagsOf(commandFlags, parsed.command);
    for (const [name, value] of Object.entries(parsed.flags)) {
        if (!(name in allowed)) {
            return `unknown option for ${parsed.command}: --${name}`;
        }
        if (allowed[name] && (value === true || value === "")) {
            return `missing value for --${name}`;
        }
        if (!allowed[name] && value !== true) {
            return `option --${name} does not take a value`;
        }
    }
    if (parsed.positionals.length > 1) {
        return `unexpected argument: ${parsed.positionals[1]}`;
    }
    return null;
}
