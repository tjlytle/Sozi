/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The stroke model: pure functions that give new drawings after a command.
 *
 * The display, a presenter's mirror and the preview decks all apply the same commands, so the
 * model lives in `protocol/`, the one module a deck and a surface share. Drawings are never
 * changed in place: a command that changes something gives new drawings, and one that changes
 * nothing gives back the same object, so a caller can compare by identity.
 *
 * @module
 */

import {MAX_STROKE_POINTS} from "./drawings.js";

/** @typedef {import("./drawings.js").Drawings} Drawings */
/** @typedef {import("./drawings.js").Stroke} Stroke */
/** @typedef {import("./drawings.js").StrokeStart} StrokeStart */
/** @typedef {import("./drawings.js").Point} Point */
/** @typedef {import("./drawings.js").DrawingCommand} DrawingCommand */
/** @typedef {import("./messages.js").Message} Message */

/**
 * Drawings with one stroke replaced, or the same drawings for an id there is not.
 *
 * @param {Drawings} drawings - The drawings.
 * @param {string} id - The stroke's id.
 * @param {(stroke: Stroke) => Stroke} change - Gives the new stroke, or the same one for none.
 * @returns {Drawings} The drawings after.
 */
function changeStroke(drawings, id, change) {
    const index = drawings.strokes.findIndex(stroke => stroke.id === id);
    if (index < 0) {
        return drawings;
    }
    const stroke = drawings.strokes[index];
    const changed = change(stroke);
    if (changed === stroke) {
        return drawings;
    }
    return {...drawings, strokes: drawings.strokes.map((s, i) => (i === index ? changed : s))};
}

/**
 * Begin a stroke, still open; an id already taken changes nothing.
 *
 * @param {Drawings} drawings - The drawings.
 * @param {StrokeStart} stroke - The stroke.
 * @returns {Drawings} The drawings after.
 */
export function beginStroke(drawings, {id, tool, color, width, points}) {
    if (drawings.strokes.some(stroke => stroke.id === id)) {
        return drawings;
    }
    const begun = {id, tool, color, width, points: points.slice(0, MAX_STROKE_POINTS), done: false};
    return {...drawings, strokes: [...drawings.strokes, begun]};
}

/**
 * Add points to an open stroke, up to `MAX_STROKE_POINTS`; a finished or unknown stroke
 * changes nothing.
 *
 * @param {Drawings} drawings - The drawings.
 * @param {string} id - The stroke's id.
 * @param {Point[]} points - The points.
 * @returns {Drawings} The drawings after.
 */
export function addPoints(drawings, id, points) {
    return changeStroke(drawings, id, stroke => {
        const room = MAX_STROKE_POINTS - stroke.points.length;
        if (stroke.done || room <= 0 || points.length === 0) {
            return stroke;
        }
        return {...stroke, points: [...stroke.points, ...points.slice(0, room)]};
    });
}

/**
 * Finish a stroke.
 *
 * @param {Drawings} drawings - The drawings.
 * @param {string} id - The stroke's id.
 * @returns {Drawings} The drawings after.
 */
export function endStroke(drawings, id) {
    return changeStroke(drawings, id, stroke => (stroke.done ? stroke : {...stroke, done: true}));
}

/**
 * Remove the last finished stroke. A stroke still being drawn stays, so an undo from one
 * surface never cuts a stroke another is drawing.
 *
 * @param {Drawings} drawings - The drawings.
 * @returns {Drawings} The drawings after.
 */
export function undoStroke(drawings) {
    const last = drawings.strokes.filter(stroke => stroke.done).at(-1);
    if (!last) {
        return drawings;
    }
    return {...drawings, strokes: drawings.strokes.filter(stroke => stroke !== last)};
}

/**
 * Remove one stroke, finished or not.
 *
 * @param {Drawings} drawings - The drawings.
 * @param {string} id - The stroke's id.
 * @returns {Drawings} The drawings after.
 */
export function eraseStroke(drawings, id) {
    const strokes = drawings.strokes.filter(stroke => stroke.id !== id);
    return strokes.length === drawings.strokes.length ? drawings : {...drawings, strokes};
}

/**
 * Remove every stroke, keeping whether the drawings are shown.
 *
 * @param {Drawings} drawings - The drawings.
 * @returns {Drawings} The drawings after.
 */
export function clearStrokes(drawings) {
    return drawings.strokes.length === 0 ? drawings : {...drawings, strokes: []};
}

/**
 * Show or hide the drawings, keeping their strokes.
 *
 * @param {Drawings} drawings - The drawings.
 * @param {boolean} visible - Show them?
 * @returns {Drawings} The drawings after.
 */
export function setVisible(drawings, visible) {
    return drawings.visible === visible ? drawings : {...drawings, visible};
}

/** What each command does to the drawings, by name (standard 2.5).
 *
 * @readonly
 * @type {Readonly<Record<string, (drawings: Drawings, message: any) => Drawings>>}
 */
const COMMANDS = Object.freeze({
    strokeBegin: beginStroke,
    strokePoints: (drawings, {id, points}) => addPoints(drawings, id, points),
    strokeEnd: (drawings, {id}) => endStroke(drawings, id),
    strokeErase: (drawings, {id}) => eraseStroke(drawings, id),
    drawingUndo: undoStroke,
    drawingClear: clearStrokes,
    drawingVisible: (drawings, {visible}) => setVisible(drawings, visible)
});

/**
 * The drawings after a command a surface sent; any other message changes nothing.
 *
 * @param {Drawings} drawings - The drawings before.
 * @param {Message} message - A message read by `protocol/messages.js`.
 * @returns {Drawings} The drawings after: the same object when nothing changed.
 */
export function applyDrawing(drawings, message) {
    return Object.hasOwn(COMMANDS, message.name)
        ? COMMANDS[message.name](drawings, message)
        : drawings;
}
