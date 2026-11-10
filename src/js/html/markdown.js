/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Notes HTML back to Markdown: turndown, plus rules for what GitHub's Markdown adds.
 *
 * @module
 */

import TurndownService from "turndown";
import {setSanitizedHTML} from "./sanitize.js";

/** A cell's Markdown on one line, with its pipes escaped.
 *
 * @param {string} content - The cell's Markdown.
 * @returns {string} What goes between the pipes.
 */
function cellText(content) {
    return content
        .trim()
        .replace(/\s*\n\s*/g, " ")
        .replace(/\|/g, "\\|");
}

/** The separator row a Markdown table needs under its first row.
 *
 * @param {any} row - The table's first row.
 * @returns {string} The separator row.
 */
function separatorRow(row) {
    return `| ${Array.from(row.cells, () => "---").join(" | ")} |\n`;
}

/** Add the rules of GitHub's Markdown, and notes headings one level down.
 *
 * @param {TurndownService} service - The converter.
 */
function addRules(service) {
    service.addRule("soziHeading", {
        filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
        replacement: (content, node) => {
            // In the document `#` always means a frame, so a notes h1 is `##`.
            const depth = Math.min(Number(node.nodeName.charAt(1)) + 1, 6);
            return `\n\n${"#".repeat(depth)} ${content}\n\n`;
        }
    });
    service.addRule("soziStrikethrough", {
        filter: ["del", "s"],
        replacement: content => `~~${content}~~`
    });
    service.addRule("soziTaskBox", {
        filter: node => node.nodeName === "INPUT" && node.getAttribute("type") === "checkbox",
        replacement: (content, node) => {
            const next = node.nextSibling;
            const spaced = next && next.nodeType === 3 && /^\s/.test(next.nodeValue || "");
            return `[${node.hasAttribute("checked") ? "x" : " "}]${spaced ? "" : " "}`;
        }
    });
    service.addRule("soziTableCell", {
        filter: ["th", "td"],
        replacement: content => ` ${cellText(content)} |`
    });
    service.addRule("soziTableRow", {
        filter: "tr",
        replacement: (content, node) => {
            const row = /** @type {any} */ (node);
            const first = row.closest("table").rows[0] === row;
            return `|${content}\n${first ? separatorRow(row) : ""}`;
        }
    });
    service.addRule("soziTableGroup", {
        filter: ["thead", "tbody", "tfoot"],
        replacement: content => content
    });
    service.addRule("soziTable", {
        filter: "table",
        replacement: content => `\n\n${content.trim()}\n\n`
    });
}

/** Convert notes HTML to Markdown.
 *
 * @param {string} html - The notes, from data.
 * @param {Document} document - The document to parse them in.
 * @returns {string} The Markdown.
 */
export function htmlToMarkdown(html, document) {
    const service = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-"
    });
    addRules(service);
    const holder = document.createElement("div");
    setSanitizedHTML(holder, html);
    return service.turndown(holder);
}
