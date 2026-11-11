/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A spawnSync for the CLI tests that keeps what the process printed when it reaches its
// time limit, so a CI log says whether a stalled browser stopped at startup or at exit
// (#232, #298).

import {spawnSync} from "node:child_process";
import type {SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns} from "node:child_process";

/** A spawn that reached its time limit, with the output it printed before it was killed. */
export type TimeoutError = Error & {
    code: "ETIMEDOUT";
    args: string[];
    stdout: string;
    stderr: string;
};

/** One block of the message: a heading, then the captured text without its trailing line
 * breaks, or `(no output)`.
 */
function block(name: string, text: string): string {
    return `--- ${name} ---\n${text.trimEnd() || "(no output)"}`;
}

/** The error for a spawn that reached its time limit; it is returned, not thrown.
 *
 * The message names the command, its arguments and the limit, then holds the stdout and
 * stderr captured so far, since a test runner prints an error's message but not its
 * other properties.
 */
export function timeoutError(
    command: string,
    args: string[],
    limitMs: number,
    result: {stdout: string; stderr: string}
): TimeoutError {
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const message = [
        `${[command, ...args].join(" ")} timed out after ${limitMs} ms`,
        block("stdout", stdout),
        block("stderr", stderr)
    ].join("\n");
    return Object.assign(new Error(message), {code: "ETIMEDOUT" as const, args, stdout, stderr});
}

/** Run `spawnSync`, and throw a `timeoutError` when the process reaches its time limit.
 *
 * Any other result, a failure to start included, is returned as `spawnSync` gave it, so
 * each caller keeps its own handling of that failure.
 */
export function spawnKeepingOutput(
    command: string,
    args: string[],
    options: SpawnSyncOptionsWithStringEncoding
): SpawnSyncReturns<string> {
    const result = spawnSync(command, args, options);
    const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ETIMEDOUT") {
        throw timeoutError(command, args, options.timeout ?? 0, result);
    }
    return result;
}
