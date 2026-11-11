/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The notes of a deck as one Markdown document: a depth-1 heading per frame with notes.
 *
 * Neither deck nor surface: `Storage`, the CLI and the presenter use it, `player/` never does.
 * The deck carries notes as HTML and stays free of Markdown.
 *
 * @module
 */

import MarkdownIt from "markdown-it";

/**
 * A frame as the presentation file holds it; other fields are kept as they are.
 *
 * @typedef {object} NotesFrame
 * @property {string} frameId - The frame's id.
 * @property {string} title - The frame's title.
 * @property {string} notes - The frame's notes as stored in the deck: an HTML fragment, not
 *     sanitized, never Markdown.
 */

/**
 * A part of the document.
 *
 * @typedef {object} NotesSection
 * @property {?string} title - The heading's text; null for the text before the first heading.
 * @property {?string} frameId - The frame its pin names, if it has one.
 * @property {string} body - The Markdown under the heading, trimmed.
 */

/**
 * What did not pair between a document and a deck.
 *
 * @typedef {object} Unmatched
 * @property {string[]} unmatchedHeadings - The sections with no frame.
 * @property {NotesFrame[]} unmatchedFrames - The frames with no section.
 */

/** The heading of a frame with an empty title.
 *
 * @readonly
 * @default
 * @type {string}
 */
const UNTITLED = "(untitled)";

/** How text before the first heading is named when it is reported.
 *
 * @readonly
 * @default
 * @type {string}
 */
const PREAMBLE = "(text before the first heading)";

/** The pin on the line under a heading: which frame the section belongs to.
 *
 * @readonly
 * @type {RegExp}
 */
const PIN = /^\s*<!--\s*frame:\s*(.+?)\s*-->\s*$/;

/** A task at the start of a list item's text.
 *
 * @readonly
 * @type {RegExp}
 */
const TASK = /^\[([ xX])\]\s+/;

/** Turn `- [x] text` into a disabled checkbox, as GitHub does.
 *
 * @param {any} state - The parser's state, with the inline tokens parsed.
 */
function taskListRule(state) {
    state.tokens.forEach((token, i) => {
        const inline = state.tokens[i + 2];
        const first = inline && inline.type === "inline" && inline.children[0];
        const match = first && first.type === "text" && TASK.exec(first.content);
        if (token.type !== "list_item_open" || !match) {
            return;
        }
        const checkbox = new state.Token("html_inline", "", 0);
        const checked = match[1] === " " ? "" : " checked";
        checkbox.content = `<input type="checkbox" disabled${checked}> `;
        first.content = first.content.slice(match[0].length);
        inline.children.unshift(checkbox);
        token.attrJoin("class", "task-list-item");
    });
}

/** The parser: CommonMark, GitHub's tables and strikethrough, HTML kept for the sanitizer.
 *
 * Nothing it renders reaches a page without `setSanitizedHTML` (standard 2.6).
 *
 * @readonly
 */
const PARSER = new MarkdownIt({html: true});
PARSER.core.ruler.after("inline", "sozi_task_list", taskListRule);

/** The key a title is compared by.
 *
 * @param {string} title - A frame's title or a heading's text.
 * @returns {string} The title on one line, with `(untitled)` for an empty one.
 */
function titleKey(title) {
    return title.trim().replace(/\s+/g, " ") || UNTITLED;
}

/** Write a title as a heading's text, so that it reads back the same.
 *
 * @param {string} title - The title.
 * @returns {string} The title with its Markdown characters escaped.
 */
function escapedTitle(title) {
    return titleKey(title).replace(/[\\`*_[\]<>#~&!]/g, "\\$&");
}

/** The plain text of a heading.
 *
 * @param {any} inline - The heading's inline token.
 * @returns {string} Its text, without markup.
 */
function headingText(inline) {
    return inline.children
        .map(child => {
            if (child.type === "softbreak") {
                return " ";
            }
            return child.type === "text" || child.type === "code_inline" ? child.content : "";
        })
        .join("");
}

/** Split a document on its depth-1 headings.
 *
 * The split comes from the parser's tokens and line maps, so a `#` in a fence or a quote
 * stays text. Text before the first heading is a section with no title.
 *
 * @param {string} markdown - The document.
 * @returns {NotesSection[]} The sections, in document order.
 */
export function parseSections(markdown) {
    const text = markdown.replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    // Cast: the tokens this reads are block tokens, which have a line map.
    const tokens = /** @type {any[]} */ (PARSER.parse(text, /** @type {any} */ ({})));
    const headings = tokens.flatMap((token, i) =>
        token.type === "heading_open" && token.tag === "h1" && token.level === 0 ? [i] : []
    );

    const bodyOf = (from, to) => lines.slice(from, to).join("\n").trim();
    const sections = headings.map((tokenIndex, n) => {
        const [start, headingEnd] = tokens[tokenIndex].map;
        const after = tokens[tokenIndex + 3];
        const pin = after && after.type === "html_block" ? PIN.exec(after.content) : null;
        const end = n + 1 < headings.length ? tokens[headings[n + 1]].map[0] : lines.length;
        return {
            start,
            title: headingText(tokens[tokenIndex + 1]),
            frameId: pin ? pin[1] : null,
            body: bodyOf(pin ? after.map[1] : headingEnd, end)
        };
    });

    const preamble = bodyOf(0, sections.length ? sections[0].start : lines.length);
    return [
        ...(preamble ? [{title: null, frameId: null, body: preamble}] : []),
        ...sections.map(({title, frameId, body}) => ({title, frameId, body}))
    ];
}

/** Pair sections with frames: by pin first, then by title, duplicates in deck order.
 *
 * Text before the first heading never pairs; it is reported with the headings.
 *
 * @param {NotesSection[]} sections - The sections of a document.
 * @param {NotesFrame[]} frames - The deck's frames, in deck order.
 * @returns {{pairs: {section: NotesSection, frame: NotesFrame}[]} & Unmatched} The pairs,
 *     in document order, and what did not pair.
 */
export function pairSections(sections, frames) {
    const owners = new Map();
    const free = new Set(frames);
    const claim = (section, frame) => {
        if (frame) {
            owners.set(section, frame);
            free.delete(frame);
        }
    };
    const titled = sections.filter(section => section.title !== null);
    for (const section of titled.filter(({frameId}) => frameId !== null)) {
        claim(
            section,
            [...free].find(frame => frame.frameId === section.frameId)
        );
    }
    for (const section of titled.filter(candidate => !owners.has(candidate))) {
        const key = titleKey(/** @type {string} */ (section.title));
        claim(
            section,
            [...free].find(frame => titleKey(frame.title) === key)
        );
    }
    return {
        pairs: sections
            .filter(section => owners.has(section))
            .map(section => ({section, frame: owners.get(section)})),
        unmatchedHeadings: sections
            .filter(section => !owners.has(section))
            .map(({title}) => (title === null ? PREAMBLE : title)),
        unmatchedFrames: [...free]
    };
}

/** Turn a section's body into notes HTML, with its headings one level higher.
 *
 * In the document `#` always means a frame, so a notes `h1` is `##` there.
 * The result is not sanitized: it goes where notes go, and `setSanitizedHTML` shows them.
 *
 * @param {{body: string}} section - The section.
 * @returns {string} The notes, as HTML.
 */
export function sectionHtml({body}) {
    const env = /** @type {any} */ ({});
    const tokens = PARSER.parse(body, env);
    for (const token of tokens) {
        if (token.type === "heading_open" || token.type === "heading_close") {
            token.tag = `h${Math.max(Number(token.tag.slice(1)) - 1, 1)}`;
        }
    }
    return PARSER.renderer.render(tokens, PARSER.options, env);
}

/** Write a deck's notes as one document.
 *
 * A frame with no notes adds nothing. A frame whose title is empty or repeated is pinned,
 * since its heading alone would not find it again.
 *
 * @param {NotesFrame[]} frames - The deck's frames, in deck order.
 * @param {(html: string) => string} htmlToMarkdown - Converts a frame's notes to Markdown.
 * @returns {string} The document.
 */
export function documentMarkdown(frames, htmlToMarkdown) {
    const counts = new Map();
    for (const {title} of frames) {
        counts.set(titleKey(title), (counts.get(titleKey(title)) || 0) + 1);
    }
    return frames
        .flatMap(({frameId, title, notes}) => {
            const body = htmlToMarkdown(notes).trim();
            if (!body) {
                return [];
            }
            const pinned = !title.trim() || counts.get(titleKey(title)) > 1;
            const pin = pinned ? `<!-- frame: ${frameId} -->\n\n` : "";
            return [`# ${escapedTitle(title)}\n\n${pin}${body}\n`];
        })
        .join("\n");
}

/** Put a document's notes in a deck's frames.
 *
 * A document wins whole: a frame it does not name has no notes. Text under an unmatched
 * heading or before the first heading still shows, attached to the section before it, or
 * to the first section, or to the deck's first frame if nothing paired.
 *
 * @template {NotesFrame} F
 * @param {F[]} frames - The deck's frames, in deck order; they are not changed.
 * @param {string} markdown - The document.
 * @returns {{frames: F[]} & Unmatched} The frames with the document's notes, and what did
 *     not pair.
 */
export function overlayNotes(frames, markdown) {
    const sections = parseSections(markdown);
    const {pairs, unmatchedHeadings, unmatchedFrames} = pairSections(sections, frames);
    const owners = new Map(pairs.map(({section, frame}) => [section, frame]));
    const firstOwner = pairs.length ? pairs[0].frame : frames[0];

    const bodies = new Map();
    let owner = firstOwner;
    for (const section of sections) {
        owner = owners.get(section) || owner;
        const stray = !owners.has(section) && section.title !== null;
        const heading = stray
            ? `## ${escapedTitle(/** @type {string} */ (section.title))}\n\n`
            : "";
        bodies.set(owner, [...(bodies.get(owner) || []), heading + section.body]);
    }
    return {
        frames: frames.map(frame => ({
            ...frame,
            notes: sectionHtml({body: (bodies.get(frame) || []).join("\n\n")})
        })),
        unmatchedHeadings,
        unmatchedFrames
    };
}
