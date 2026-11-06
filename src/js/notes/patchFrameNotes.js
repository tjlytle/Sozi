/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Change the notes of frames in the text of a presentation file, and no other byte of it.
 *
 * `JSON.parse` gives no positions, so this walks the text. The text has already been parsed,
 * so the walk checks nothing.
 *
 * @module
 */

/** An array element or an object member, as positions in the text.
 *
 * For an array element, the key's positions are both those of the value.
 *
 * @typedef {object} JsonItem
 * @property {number} keyStart - Where the key starts.
 * @property {number} keyEnd - Where the key ends.
 * @property {number} valueStart - Where the value starts.
 * @property {number} valueEnd - Where the value ends.
 */

const SPACE = " \t\r\n";

/** Skip JSON whitespace.
 *
 * @param {string} text - The text.
 * @param {number} start - Where to start.
 * @returns {number} The position of the next character that is not whitespace.
 */
function skipSpace(text, start) {
    let at = start;
    while (SPACE.includes(text[at])) {
        at++;
    }
    return at;
}

/** Find the end of a string.
 *
 * A loop and not a regular expression: notes can hold whole images as data URLs.
 *
 * @param {string} text - The text.
 * @param {number} start - The position of the opening quote.
 * @returns {number} The position after the closing quote.
 */
function stringEnd(text, start) {
    let at = start + 1;
    while (text[at] !== '"') {
        at += text[at] === "\\" ? 2 : 1;
    }
    return at + 1;
}

/** Find the end of a value of any type.
 *
 * @param {string} text - The text.
 * @param {number} start - Where the value starts.
 * @returns {number} The position after the value.
 */
function valueEnd(text, start) {
    let at = start;
    if (!'"{['.includes(text[at])) {
        while (!`,]}${SPACE}`.includes(text[at])) {
            at++;
        }
        return at;
    }
    let depth = 0;
    do {
        if (text[at] === '"') {
            at = stringEnd(text, at);
        } else {
            depth += Number("{[".includes(text[at])) - Number("}]".includes(text[at]));
            at++;
        }
    } while (depth > 0);
    return at;
}

/** List what an object or an array holds.
 *
 * @param {string} text - The text.
 * @param {number} start - The position of the opening bracket.
 * @returns {JsonItem[]} The members or elements, in file order.
 */
function itemsOf(text, start) {
    const hasKeys = text[start] === "{";
    const closing = hasKeys ? "}" : "]";
    const items = [];
    let at = skipSpace(text, start + 1);
    while (text[at] !== closing) {
        const keyEnd = hasKeys ? stringEnd(text, at) : at;
        const valueStart = hasKeys ? skipSpace(text, skipSpace(text, keyEnd) + 1) : at;
        const end = valueEnd(text, valueStart);
        items.push({keyStart: at, keyEnd, valueStart, valueEnd: end});
        at = skipSpace(text, end);
        if (text[at] === ",") {
            at = skipSpace(text, at + 1);
        }
    }
    return items;
}

/** Find a member of an object. Of a repeated key the last counts, as in `JSON.parse`.
 *
 * @param {string} text - The text.
 * @param {JsonItem[]} members - The object's members.
 * @param {string} name - The key.
 * @returns {JsonItem|undefined} The member, if there is one.
 */
function memberNamed(text, members, name) {
    return members
        .filter(({keyStart, keyEnd}) => JSON.parse(text.slice(keyStart, keyEnd)) === name)
        .at(-1);
}

/** Say how to put a frame's notes in the text.
 *
 * A frame without the field gets it after its last member, spaced as that member is.
 *
 * @param {string} text - The text.
 * @param {JsonItem} frame - The frame, as an element of the frames.
 * @param {string} html - The notes.
 * @returns {{start: number, end: number, value: string}} The range to replace and its new text.
 */
function notesEdit(text, frame, html) {
    const value = JSON.stringify(html);
    const members = itemsOf(text, frame.valueStart);
    const notes = memberNamed(text, members, "notes");
    if (notes) {
        return {start: notes.valueStart, end: notes.valueEnd, value};
    }
    const last = members.at(-1);
    if (!last) {
        const start = frame.valueStart + 1;
        return {start, end: start, value: `"notes": ${value}`};
    }
    let indent = last.keyStart;
    while (SPACE.includes(text[indent - 1])) {
        indent--;
    }
    return {
        start: last.valueEnd,
        end: last.valueEnd,
        value: `,${text.slice(indent, last.keyStart)}"notes"${text.slice(last.keyEnd, last.valueStart)}${value}`
    };
}

/** Change the notes of some frames in the text of a presentation file.
 *
 * @param {string} text - The text, which `JSON.parse` accepts, of an object with `frames`.
 * @param {Map<number, string>} notes - The new notes as HTML, by the frame's index in `frames`.
 * @returns {string} The same text but for those frames' notes.
 */
export function patchFrameNotes(text, notes) {
    const root = itemsOf(text, skipSpace(text, 0));
    // Cast: the caller's frames come from this text, so the member is there.
    const framesMember = /** @type {JsonItem} */ (memberNamed(text, root, "frames"));
    const frames = itemsOf(text, framesMember.valueStart);
    return [...notes]
        .map(([index, html]) => notesEdit(text, frames[index], html))
        .sort((a, b) => b.start - a.start)
        .reduce(
            (result, {start, end, value}) => result.slice(0, start) + value + result.slice(end),
            text
        );
}
