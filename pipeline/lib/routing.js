/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Which harness runs a stage: the adapters there are, and the lines of a plan's Harness
// section that move a stage off its setting.

/** The harness adapters under pipeline/harness/. */
export const HARNESSES = ["claude", "codex", "agy", "opencode"];

/** The stages a plan may route; the plan stage runs before any plan exists. */
const ROUTED_STAGES = ["tests", "build", "review", "qa"];

/**
 * @typedef {{harness: string, model: string}} Route
 */

/**
 * Read the lines of the Harness section of a plan: from its heading to the next heading.
 *
 * @param {string} text - A plan comment.
 * @returns {string[]} - The non-empty lines, without list marks or backticks.
 */
function harnessLines(text) {
    const lines = text.split("\n");
    const start = lines.findIndex(l => /^\*\*Harness\*\*\s*$/.test(l.trim()));
    if (start < 0) {
        return [];
    }
    const section = [];
    for (const line of lines.slice(start + 1)) {
        if (/^(\*\*[^*]+\*\*|#+ )/.test(line.trim())) {
            break;
        }
        const bare = line
            .trim()
            .replace(/^[-*]\s+/, "")
            .replaceAll("`", "")
            .trim();
        if (bare !== "" && !/^none\.?$/i.test(bare)) {
            section.push(bare);
        }
    }
    return section;
}

/**
 * Read the stages a plan routes from its Harness section, `<stage>: <harness> <model>` a
 * line. A line for the plan stage, an unknown stage or harness, or with no model, is bad.
 *
 * @param {string} text - A plan comment.
 * @returns {{routes: Record<string, Route>, bad: string[]}} - The routes by stage, and the bad lines.
 */
export function planRoutes(text) {
    /** @type {Record<string, Route>} */
    const routes = {};
    /** @type {string[]} */
    const bad = [];
    for (const line of harnessLines(text ?? "")) {
        const m = /^(\w+):\s*(\S+)\s+(\S+)$/.exec(line);
        if (m && ROUTED_STAGES.includes(m[1]) && HARNESSES.includes(m[2])) {
            routes[m[1]] = {harness: m[2], model: m[3]};
        } else {
            bad.push(line);
        }
    }
    return {routes, bad};
}
