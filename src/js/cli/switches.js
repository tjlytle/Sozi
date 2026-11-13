/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The Chromium switches of `sozi --cli`, and the line it prints when a Chromium helper
 * process dies.
 *
 * Pure functions with no Electron import, so that a unit test can load them.
 *
 * @module
 */

/** The Chromium switches that command-line mode appends, as `appendSwitch` arguments.
 *
 * The command line never shows a window, so it renders at device scale 1 on any display:
 * the export window then has the requested size in pixels. On Linux, Chromium's shared
 * memory goes to /tmp instead of /dev/shm: in a container /dev/shm is often Docker's 64 MB
 * default, where renderers crash and Chromium can end the run without a result (#210).
 *
 * @param {string} platform - The platform, as in `process.platform`.
 * @returns {string[][]} - One `[switch]` or `[switch, value]` per switch.
 */
export function cliSwitches(platform) {
    const switches = [["force-device-scale-factor", "1"]];
    if (platform === "linux") {
        switches.push(["disable-dev-shm-usage"]);
    }
    return switches;
}

/** The standard error line for a Chromium helper process that died.
 *
 * @param {{type: string, reason: string, exitCode: number, name?: string}} details - The
 *  details of Electron's `child-process-gone` event.
 * @returns {string} - `sozi: <type> process gone: <reason> (exit <code>[, <name>])`.
 */
export function processGoneLine({type, reason, exitCode, name}) {
    const exit = name ? `exit ${exitCode}, ${name}` : `exit ${exitCode}`;
    return `sozi: ${type} process gone: ${reason} (${exit})`;
}
