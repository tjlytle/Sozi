/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// test/pipeline/github-world.js: the fake runner the GitHub client tests share.
import {createGithub} from "../../pipeline/lib/github.js";

/** @type {{cmd: string[], opts: any}[]} */
export const calls = [];

/**
 * Make a fake runner that replays canned replies and records each call.
 * @param {{code?: number, stdout?: string, stderr?: string}[]} replies - The replies, in order.
 * @returns {(cmd: string[], opts?: any) => Promise<{code: number, stdout: string, stderr: string}>} The runner.
 */
const fake = replies => async (cmd, opts) => {
    calls.push({cmd, opts});
    const r = replies.shift();
    return {code: r?.code ?? 0, stdout: r?.stdout ?? "", stderr: r?.stderr ?? ""};
};

/**
 * Make a Github over a fake runner and clear the call log.
 * @param {{code?: number, stdout?: string, stderr?: string}[]} replies - The replies, in order.
 * @returns {ReturnType<typeof createGithub>} The client.
 */
export function make(replies) {
    calls.length = 0;
    return createGithub({repo: "tjlytle/Sozi", run: fake(replies)});
}

export const json = value => ({stdout: JSON.stringify(value)});
