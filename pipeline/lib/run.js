/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Opening and closing a run of the loop: the mint endpoint containers fetch tokens from,
// and the run's Notion page (its start, its notes and its closing summary).

import crypto from "node:crypto";
import path from "node:path";
import {main as digestMain, notion, runs} from "../../bin/digest.js";

const DEFAULT_MINT_PORT = 7311;
const BRIDGE_FALLBACK = "172.17.0.1";

/**
 * @typedef {object} RunDeps
 * @property {import("./github.js").Runner} run - Runs commands on the host.
 * @property {typeof import("./mint.js").startMint} startMint - Starts the mint endpoint.
 * @property {typeof digestMain} [digest] - The digest command line; bin/digest.js when absent.
 */

/** The address of the Docker bridge, which the mint binds to.
 *
 * @param {import("./github.js").Runner} run - The command runner.
 * @returns {Promise<string>} - The gateway address.
 */
async function bridgeAddress(run) {
    const r = await run([
        "docker",
        "network",
        "inspect",
        "bridge",
        "-f",
        "{{(index .IPAM.Config 0).Gateway}}"
    ]);
    const address = r.stdout.trim();
    return r.code === 0 && /^[\d.]+$/.test(address) ? address : BRIDGE_FALLBACK;
}

/** Open the run: the mint endpoint containers fetch tokens from, and the Notion page.
 *
 * @param {any} state - The loop state; gets mintKey, mintUrl and notionPage.
 * @param {any} settings - The settings.
 * @param {Record<string, string|undefined>} env - The environment, with the secrets.
 * @param {(line: string) => void} log - The log.
 * @param {RunDeps} deps - The outside world.
 * @returns {Promise<{close: () => Promise<void>}>} - The mint endpoint.
 */
export async function openRun(state, settings, env, log, deps) {
    const adopting =
        Object.values(state.issues).some((/** @type {any} */ r) => r.session) ||
        (state.run.sessions ?? []).length > 0;
    if (!adopting || !state.run.mintKey) {
        state.run.mintKey = crypto.randomBytes(32).toString("hex");
    }
    const mint = await deps.startMint({
        port: settings.mintPort || DEFAULT_MINT_PORT,
        host: await bridgeAddress(deps.run),
        key: state.run.mintKey,
        repos: [settings.repo],
        log: e => log(`mint ${e.bot} ${e.status}${e.reason ? ` ${e.reason}` : ""}`)
    });
    state.run.mintUrl = `http://host.docker.internal:${mint.port}/`;
    if (state.run.notionPage) {
        return mint;
    }
    if (!settings.notionParent || !env.NOTION_TOKEN) {
        log("digest: PIPELINE_NOTION_PARENT or NOTION_TOKEN unset; no Notion page");
        return mint;
    }
    let page = "";
    const title = `Sozi pipeline ${state.run.started.slice(0, 16)}`;
    await (deps.digest ?? digestMain)(
        ["start", "--title", title, "--parent", settings.notionParent],
        {env, out: text => (page += text), err: log}
    );
    state.run.notionPage = page.trim() || null;
    return mint;
}

/** The build links of the closing summary: the Actions page, and the presenter page CI
 * published for master's head when an evidence bucket is set.
 *
 * @param {any} settings - The settings.
 * @param {string} root - The repository root, where var/pipeline/mirror.git lives.
 * @param {import("./github.js").Runner} run - The command runner.
 * @returns {Promise<string[]>} - The --build and --presenter options.
 */
async function buildLinks(settings, root, run) {
    const links = ["--build", `https://github.com/${settings.repo}/actions`];
    const base = settings.evidence.url.replace(/\/+$/, "");
    if (!base) {
        return links;
    }
    const mirror = path.join(root, "var", "pipeline", "mirror.git");
    const r = await run(["git", "-C", mirror, "rev-parse", "master"]);
    const sha = r.stdout.trim();
    if (r.code === 0 && /^[0-9a-f]{7,64}$/.test(sha)) {
        links.push("--presenter", `${base}/builds/${sha}/presenter.html`);
    }
    return links;
}

/** Write the closing summary to the run's Notion page, when there is one.
 *
 * @param {object} options - The run.
 * @param {any} options.state - The loop state.
 * @param {string} options.reason - Why the run ends.
 * @param {any} options.settings - The settings.
 * @param {string} options.root - The repository root.
 * @param {Record<string, string|undefined>} options.env - The environment, with the secrets.
 * @param {(line: string) => void} options.log - The log.
 * @param {RunDeps} options.deps - The outside world.
 * @returns {Promise<boolean>} - Whether the run is finished: the summary was posted, or
 *     there was no page to post to.
 */
export async function finishDigest({state, reason, settings, root, env, log, deps}) {
    if (!state.run.notionPage || !env.NOTION_TOKEN) {
        log("digest: no page for this run");
        return true;
    }
    const cost = Number(state.run.costUsd).toFixed(2);
    const summary = `Stopped: ${reason}. ${state.run.tokens} tokens, $${cost}.`;
    const links = await buildLinks(settings, root, deps.run);
    const code = await (deps.digest ?? digestMain)(["finish", "--summary", summary, ...links], {
        env: {...env, PIPELINE_NOTION_PAGE: state.run.notionPage},
        err: log
    });
    return code === 0;
}

/** The digest the pass adds notes to: a plain paragraph on the run's page, no checkbox.
 *
 * @param {any} state - The loop state.
 * @param {Record<string, string|undefined>} env - The environment, with the secrets.
 * @returns {{add: (entry: {issue: number, text: string}) => Promise<void>}} - The digest.
 */
export function noteDigest(state, env) {
    return {
        async add({issue, text}) {
            const token = env.NOTION_TOKEN;
            if (!state.run.notionPage || !token) {
                return;
            }
            const line = issue ? `#${issue} ${text}` : text;
            const children = [
                {object: "block", type: "paragraph", paragraph: {rich_text: runs(line)}}
            ];
            const where = `/blocks/${state.run.notionPage}/children`;
            await notion("PATCH", where, {children}, {token});
        }
    };
}
