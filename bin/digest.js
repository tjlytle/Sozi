#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Notion checklist for a run. One page per run, a to-do per merged issue (written by
// the QA session, with a link to the issue and a screenshot when there is one), and at
// the end a summary with links to the build.
//
//   node bin/digest.js start --title T [--parent ID]
//   node bin/digest.js add --issue N --text "..." --url URL [--image URL] [--page ID]
//   node bin/digest.js finish --summary "..." [--build URL] [--presenter URL] [--page ID]
//
// Environment: NOTION_TOKEN (an integration token), PIPELINE_NOTION_PARENT (the page the
// run pages go under) and PIPELINE_NOTION_PAGE (the default for --page). `start` prints
// the new page id on stdout; `add` and `finish` print nothing. A page id (--parent, --page
// and their variables) may be the page URL, its `Title-<id>` slug, the bare 32 hex digits or
// the dashed UUID. A missing option or token, or a page id with no 32 hex digits, prints a
// message on stderr and exits 1; any other subcommand prints this usage and exits 2.

import {parseArgs} from "node:util";
import {pathToFileURL} from "node:url";

const USAGE = [
    "usage:",
    "  node bin/digest.js start --title T [--parent ID]",
    '  node bin/digest.js add --issue N --text "..." --url URL [--image URL] [--page ID]',
    '  node bin/digest.js finish --summary "..." [--build URL] [--presenter URL] [--page ID]'
];

const API = "https://api.notion.com/v1";

/** The longest rich text run Notion accepts. */
const MAX_RUN = 2000;

/** Rich text runs for a text, split so none passes Notion's length limit.
 *
 * @param {string} text - The text.
 * @param {object} [options] - How to mark it up.
 * @param {string} [options.link] - A URL for the first run to link to.
 * @returns {any[]} - The rich text runs, at least one.
 */
export function runs(text, {link} = {}) {
    const parts = [];
    for (let at = 0; at < text.length || parts.length === 0; at += MAX_RUN) {
        const content = text.slice(at, at + MAX_RUN);
        parts.push({text: parts.length === 0 && link ? {content, link: {url: link}} : {content}});
    }
    return parts;
}

/** The Notion page id in a value pasted from Notion: the page URL, its `Title-<id>` slug,
 * the bare 32 hex digits or the dashed UUID. The query and fragment are ignored, so a
 * `?v=<view id>` does not win; the id is the last 32 digits of the last hex run.
 *
 * @param {string} value - The value as given.
 * @param {string} name - The setting it came from, for the error.
 * @returns {string} - The id as 32 lower-case hex digits.
 */
export function pageId(value, name) {
    const hex = value
        .split(/[?#]/)[0]
        .replaceAll("-", "")
        .match(/[0-9a-f]{32,}/gi);
    if (!hex) {
        throw new Error(`${name} has no Notion page id: ${JSON.stringify(value)}`);
    }
    return hex[hex.length - 1].slice(-32).toLowerCase();
}

/** The body of the request that creates a run page.
 *
 * @param {object} options - The page.
 * @param {string} options.title - The page title.
 * @param {string} options.parent - The id of the page it goes under.
 * @returns {any} - The body for POST /v1/pages.
 */
export function pageRequest({title, parent}) {
    return {
        parent: {page_id: parent},
        properties: {title: {title: runs(title)}},
        children: [
            {
                object: "block",
                type: "paragraph",
                paragraph: {rich_text: [...runs("Checklist for this run; the trail is on GitHub.")]}
            }
        ]
    };
}

/** The blocks for one merged issue: a to-do, then its screenshot when there is one.
 *
 * @param {object} options - The entry.
 * @param {string|number} options.issue - The issue number.
 * @param {string} options.text - What to check by hand.
 * @param {string} options.url - The issue URL.
 * @param {string} [options.image] - The URL of a screenshot.
 * @returns {any[]} - The blocks.
 */
export function entryBlocks({issue, text, url, image}) {
    /** @type {any[]} */
    const blocks = [
        {
            object: "block",
            type: "to_do",
            to_do: {
                rich_text: [...runs(`#${issue}`, {link: url}), ...runs(` ${text}`)],
                checked: false
            }
        }
    ];
    if (image) {
        blocks.push({
            object: "block",
            type: "image",
            image: {type: "external", external: {url: image}}
        });
    }
    return blocks;
}

/** The closing blocks: the summary, then a bookmark per link given.
 *
 * @param {object} options - The summary.
 * @param {string} options.summary - The one-line result of the run.
 * @param {string} [options.build] - The URL of the build.
 * @param {string} [options.presenter] - The URL of the presenter.
 * @returns {any[]} - The blocks.
 */
export function finishBlocks({summary, build, presenter}) {
    /** @type {any[]} */
    const blocks = [
        {
            object: "block",
            type: "callout",
            callout: {rich_text: runs(summary), icon: {emoji: "✅"}}
        }
    ];
    for (const url of [build, presenter]) {
        if (url) {
            blocks.push({object: "block", type: "bookmark", bookmark: {url}});
        }
    }
    return blocks;
}

/**
 * @typedef {object} NotionResponse
 * @property {boolean} ok - Whether the request succeeded.
 * @property {number} status - The HTTP status.
 * @property {() => Promise<any>} json - The parsed body.
 * @property {() => Promise<string>} text - The body as text.
 */

/** Call the Notion API.
 *
 * @param {string} method - The HTTP method.
 * @param {string} path - The path after /v1, starting with a slash.
 * @param {any} body - The JSON body, if any.
 * @param {object} options - How to call it.
 * @param {string} options.token - The integration token.
 * @param {(url: string, init: object) => Promise<NotionResponse>} [options.fetch] - The HTTP client.
 * @param {number} [options.timeoutMs] - Abort after this many milliseconds; 30000 by default.
 * @returns {Promise<any>} - The parsed reply.
 */
export async function notion(
    method,
    path,
    body,
    {token, fetch: doFetch = fetch, timeoutMs = 30000}
) {
    const response = await doFetch(`${API}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json"
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
        const text = await response.text();
        const redacted = text.split(token).join("***");
        throw new Error(
            `notion ${method} ${path} failed: ${response.status} ${redacted.slice(0, 200)}`.trim()
        );
    }
    return response.json();
}

/** Read the options of a subcommand.
 *
 * @param {string[]} args - The arguments after the subcommand.
 * @returns {Record<string, string|undefined>} - The option values.
 */
function options(args) {
    const names = [
        "title",
        "parent",
        "issue",
        "text",
        "url",
        "image",
        "page",
        "summary",
        "build",
        "presenter"
    ];
    const spec = Object.fromEntries(names.map(name => [name, {type: "string"}]));
    return /** @type {Record<string, string|undefined>} */ (
        parseArgs({args, options: /** @type {any} */ (spec)}).values
    );
}

/** Run the command line.
 *
 * @param {string[]} argv - The arguments after the script name.
 * @param {object} [io] - Where things come from and go to.
 * @param {Record<string, string|undefined>} [io.env] - The environment.
 * @param {(url: string, init: object) => Promise<NotionResponse>} [io.fetch] - The HTTP client.
 * @param {(text: string) => void} [io.out] - Standard output.
 * @param {(text: string) => void} [io.err] - Standard error.
 * @returns {Promise<number>} - The exit status.
 */
export async function main(argv, {env = process.env, fetch: doFetch = fetch, out, err} = {}) {
    const write = out ?? (text => void process.stdout.write(text));
    const writeErr = err ?? (text => void process.stderr.write(text));
    const [command, ...rest] = argv;
    if (!["start", "add", "finish"].includes(command ?? "")) {
        writeErr(`${USAGE.join("\n")}\n`);
        return 2;
    }
    try {
        const opt = options(rest);
        const need = (/** @type {string|undefined} */ value, /** @type {string} */ name) => {
            if (!value) {
                throw new Error(`${name} is not set`);
            }
            return value;
        };
        const numeric = (/** @type {string} */ value) => {
            if (!/^\d+$/.test(value)) {
                throw new Error(`--issue must be a number: ${JSON.stringify(value)}`);
            }
            return value;
        };
        const token = need(env.NOTION_TOKEN, "NOTION_TOKEN");
        const call = {token, fetch: doFetch};
        if (command === "start") {
            const title = need(opt.title, "--title");
            const parentName = "--parent or PIPELINE_NOTION_PARENT";
            const parent = pageId(
                need(opt.parent ?? env.PIPELINE_NOTION_PARENT, parentName),
                parentName
            );
            const page = await notion("POST", "/pages", pageRequest({title, parent}), call);
            if (!page?.id) {
                throw new Error("Notion returned no page id");
            }
            write(`${page.id}\n`);
            return 0;
        }
        const pageName = "--page or PIPELINE_NOTION_PAGE";
        const page = pageId(need(opt.page ?? env.PIPELINE_NOTION_PAGE, pageName), pageName);
        const children =
            command === "add"
                ? entryBlocks({
                      issue: numeric(need(opt.issue, "--issue")),
                      text: need(opt.text, "--text"),
                      url: need(opt.url, "--url"),
                      image: opt.image
                  })
                : finishBlocks({
                      summary: need(opt.summary, "--summary"),
                      build: opt.build,
                      presenter: opt.presenter
                  });
        await notion("PATCH", `/blocks/${page}/children`, {children}, call);
        return 0;
    } catch (error) {
        writeErr(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(await main(process.argv.slice(2)));
}
