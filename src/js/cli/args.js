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

/** Flags that never take a value (besides those starting with `--no-`).
 *
 * @type {Set<string>}
 */
const BOOLEAN_FLAGS = new Set(["help"]);

/** Parse the command line of the Electron main process.
 *
 * Everything up to and including `--cli` is skipped (Electron binary, app
 * path, Chromium switches). After `--cli`, the first non-flag argument is the
 * command; other non-flag arguments are positionals. Flags are
 * `--name=value`, `--name value`, or boolean (`--no-xxx`, `--help`, or a flag
 * with no following value).
 *
 * @param {string[]} argv - The process arguments, e.g. `process.argv`.
 * @returns {{cli: boolean, command: ?string, positionals: string[], flags: object}} - The parsed arguments.
 */
export function parseArgs(argv) {
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
            if (name.startsWith("no-") || BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith("--")) {
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
