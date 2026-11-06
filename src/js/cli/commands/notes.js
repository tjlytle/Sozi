/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The `notes` command of `sozi --cli`: the deck's notes as one Markdown document.
 *
 * `export` writes the document; `import` writes its sections back to the presentation file.
 *
 * @module
 */

import {htmlToMarkdown} from "../../html/markdown";
import {isBlankHTML} from "../../html/sanitize";
import {notesFileOf} from "../../naming";
import {
    documentMarkdown,
    pairSections,
    parseSections,
    sectionHtml
} from "../../notes/notesDocument";

/** The flags of this command (see {@link module:cli/args.GLOBAL_FLAGS}).
 *
 * @type {{[name: string]: (boolean|string)}}
 */
export const FLAGS = {presentation: true};

/** The usage error of a `notes` command line.
 *
 * @param {object} _flags - The command-line flags.
 * @param {string[]} positionals - The positional arguments: the action, the file, the Markdown file.
 * @returns {?string} - An error message, or `null` if the command line is valid.
 */
export function checkFlags(_flags, [action, file, markdownFile]) {
    if (action !== "export" && action !== "import") {
        return `unknown notes action: ${action}; expected export or import`;
    }
    return action === "import" && file && !markdownFile ? "missing Markdown file argument" : null;
}

/** The frames of a parsed presentation file, with what the document needs filled in.
 *
 * @param {any} data - The parsed presentation file.
 * @returns {import("../../notes/notesDocument").NotesFrame[]} - The frames, as they are in `data`.
 */
function framesOf(data) {
    for (const frame of data.frames) {
        frame.title = frame.title || "";
        frame.notes = frame.notes || "";
    }
    return data.frames;
}

/** Export the notes of a presentation to a Markdown file, or into the result.
 *
 * @param {any} context - The command context.
 * @returns {object} - The command result.
 */
function exportNotes({cwd, positionals, presentation, document}) {
    const fs = require("fs");
    const path = require("path");

    const data = JSON.parse(fs.readFileSync(presentation, {encoding: "utf-8"}));
    const markdown = documentMarkdown(framesOf(data), html => htmlToMarkdown(html, document));
    if (!positionals[2]) {
        return {ok: true, files: [], markdown};
    }
    const file = path.resolve(cwd, positionals[2]);
    fs.writeFileSync(file, markdown, {encoding: "utf-8"});
    return {ok: true, files: [file]};
}

/** Write the sections of a Markdown file back to the presentation file.
 *
 * The parsed file is patched and written back, not saved through the model, which drifts
 * camera coordinates (see the `build` command): only the notes of the frames changed differ.
 * A section whose Markdown is what the frame's notes export to is left alone, since HTML to
 * Markdown to HTML is not the identity. Unmatched sections do not fail the import.
 *
 * @param {any} context - The command context.
 * @returns {object} - The command result.
 */
function importNotes({cwd, positionals, presentation, document, warnings}) {
    const fs = require("fs");
    const path = require("path");

    const file = path.resolve(cwd, positionals[2]);
    if (!fs.existsSync(file)) {
        return {ok: false, error: `file not found: ${file}`};
    }
    const text = fs.readFileSync(presentation, {encoding: "utf-8"});
    const data = JSON.parse(text);
    const sections = parseSections(fs.readFileSync(file, {encoding: "utf-8"}));
    const {pairs, unmatchedHeadings, unmatchedFrames} = pairSections(sections, framesOf(data));

    const edited = pairs.filter(
        ({section, frame}) => section.body !== htmlToMarkdown(frame.notes, document).trim()
    );
    for (const {section, frame} of edited) {
        frame.notes = sectionHtml(section);
    }
    if (edited.length) {
        // Keep whatever followed the JSON in the file, usually a line end.
        const tail = text.slice(text.trimEnd().length);
        fs.writeFileSync(presentation, JSON.stringify(data, null, "  ") + tail, {
            encoding: "utf-8"
        });
    }

    // Only a frame with notes is worth reporting: export gives an empty frame no section.
    const frames = unmatchedFrames
        .filter(({notes}) => !isBlankHTML(notes, document))
        .map(({title}) => title);
    warnings.push(
        ...unmatchedHeadings.map(heading => `no frame for the heading "${heading}"`),
        ...frames.map(title => `no section for the frame "${title}"; it keeps its notes`)
    );
    const beside = notesFileOf(presentation);
    if (fs.existsSync(beside)) {
        warnings.push(
            `${path.basename(beside)} is beside the deck: the presenter shows it, not the notes in ${path.basename(presentation)}`
        );
    }
    return {
        ok: true,
        changed: edited.map(({frame}) => frame.frameId),
        unmatched: {headings: unmatchedHeadings, frames},
        files: edited.length ? [presentation] : []
    };
}

/** Export the notes of a presentation that has been loaded, or import them.
 *
 * Both read the presentation file itself, so that the model's upgrades and rounding reach
 * neither the document nor the file.
 *
 * @param {object} context - The command context.
 * @param {string[]} context.positionals - The action, the file and the Markdown file.
 * @returns {object} - The command result.
 */
export function notes(context) {
    return context.positionals[0] === "export" ? exportNotes(context) : importNotes(context);
}
