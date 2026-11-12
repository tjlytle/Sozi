/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The messages a display and its surfaces exchange about the drawings on the deck.
 *
 * A surface sends a command (begin a stroke, add points to it, end it, erase it, undo, clear,
 * show or hide); the display carries it out and relays it to every surface. The whole drawings
 * go only in the display's `hello` and, as `drawings`, from a presenter to its preview decks.
 * `readMessage` in `messages.js` reads these messages too; `strokes.js` applies them.
 *
 * @module
 */

/** The tools a stroke is drawn with.
 *
 * @readonly
 */
export const Tools = Object.freeze({pen: "pen", highlighter: "highlighter"});

/** The most points one message carries.
 *
 * @readonly
 * @type {number}
 */
export const MAX_POINTS_PER_MESSAGE = 1000;

/** The most points a stroke keeps: it takes no more after that.
 *
 * @readonly
 * @type {number}
 */
export const MAX_STROKE_POINTS = 10000;

/** The longest id a stroke may have.
 *
 * @readonly
 * @type {number}
 */
const MAX_ID_LENGTH = 64;

/** A point of a stroke: `[x, y, pressure]`, in the canvas units of the bottom layer's camera, with
 * a pressure from 0 to 1.
 *
 * @typedef {number[]} Point
 */

/**
 * A stroke as a surface begins it.
 *
 * @typedef {object} StrokeStart
 * @property {string} id - Its id, chosen by the surface that draws it.
 * @property {string} tool - One of `Tools`.
 * @property {string} color - Its colour, as `#rrggbb`.
 * @property {number} width - Its base width, in canvas units.
 * @property {Point[]} points - Its points so far.
 */

/** A stroke as the display holds it: `done` once its surface has ended it.
 *
 * @typedef {StrokeStart & {done: boolean}} Stroke
 */

/**
 * The drawings on the deck.
 *
 * @typedef {object} Drawings
 * @property {boolean} visible - Are they shown?
 * @property {Stroke[]} strokes - Every stroke, in the order it was begun.
 */

/** @typedef {{name: "strokeBegin"} & StrokeStart} StrokeBeginMessage */
/** @typedef {{name: "strokePoints", id: string, points: Point[]}} StrokePointsMessage */
/** @typedef {{name: "strokeEnd", id: string}} StrokeEndMessage */
/** @typedef {{name: "strokeErase", id: string}} StrokeEraseMessage */
/** @typedef {{name: "drawingUndo"}} DrawingUndoMessage */
/** @typedef {{name: "drawingClear"}} DrawingClearMessage */
/** @typedef {{name: "drawingVisible", visible: boolean}} DrawingVisibleMessage */
/** @typedef {{name: "drawings"} & Drawings} DrawingsMessage */

/** A command a surface sends to change the drawings, which the display relays.
 *
 * @typedef {StrokeBeginMessage | StrokePointsMessage | StrokeEndMessage | StrokeEraseMessage
 *   | DrawingUndoMessage | DrawingClearMessage | DrawingVisibleMessage} DrawingCommand
 */

/** The names of the commands a surface sends to change the drawings.
 *
 * @readonly
 */
export const DRAWING_COMMANDS = Object.freeze([
    "strokeBegin",
    "strokePoints",
    "strokeEnd",
    "strokeErase",
    "drawingUndo",
    "drawingClear",
    "drawingVisible"
]);

/** No drawings, shown: what a display starts with, and what a deck from before drawings reads as.
 *
 * @readonly
 * @type {Readonly<Drawings>}
 */
export const EMPTY_DRAWINGS = Object.freeze({
    visible: true,
    // The model never changes a list in place (strokes.js), so the list needs no freezing.
    strokes: /** @type {Stroke[]} */ ([])
});

/**
 * Build a `strokeBegin`: begin a stroke.
 *
 * @param {StrokeStart} stroke - The stroke.
 * @returns {StrokeBeginMessage} The message.
 */
export function strokeBeginMessage({id, tool, color, width, points}) {
    return {name: "strokeBegin", id, tool, color, width, points};
}

/**
 * Build a `strokePoints`: add points to a stroke being drawn.
 *
 * @param {string} id - The stroke's id.
 * @param {Point[]} points - The points.
 * @returns {StrokePointsMessage} The message.
 */
export function strokePointsMessage(id, points) {
    return {name: "strokePoints", id, points};
}

/**
 * Build a `strokeEnd`: the stroke is finished.
 *
 * @param {string} id - The stroke's id.
 * @returns {StrokeEndMessage} The message.
 */
export function strokeEndMessage(id) {
    return {name: "strokeEnd", id};
}

/**
 * Build a `strokeErase`: remove one stroke.
 *
 * @param {string} id - The stroke's id.
 * @returns {StrokeEraseMessage} The message.
 */
export function strokeEraseMessage(id) {
    return {name: "strokeErase", id};
}

/**
 * Build a `drawingUndo`: remove the last finished stroke.
 *
 * @returns {DrawingUndoMessage} The message.
 */
export function drawingUndoMessage() {
    return {name: "drawingUndo"};
}

/**
 * Build a `drawingClear`: remove every stroke.
 *
 * @returns {DrawingClearMessage} The message.
 */
export function drawingClearMessage() {
    return {name: "drawingClear"};
}

/**
 * Build a `drawingVisible`: show or hide the drawings, keeping them.
 *
 * @param {boolean} visible - Show them?
 * @returns {DrawingVisibleMessage} The message.
 */
export function drawingVisibleMessage(visible) {
    return {name: "drawingVisible", visible};
}

/**
 * Build a `drawings`: the drawings a preview deck shows.
 *
 * @param {Drawings} drawings - The drawings.
 * @returns {DrawingsMessage} The message.
 */
export function drawingsMessage({visible, strokes}) {
    return {name: "drawings", visible, strokes};
}

/**
 * Is it a stroke id: a string of 1 to 64 characters?
 *
 * @param {any} v - The value.
 * @returns {boolean} True for an id.
 */
function isId(v) {
    return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
}

/**
 * Is it a finite number?
 *
 * @param {any} v - The value.
 * @returns {boolean} True for a finite number.
 */
function isNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
}

/**
 * Read a list of received points.
 *
 * @param {any} points - The list as received.
 * @param {number} max - The most points it may hold.
 * @returns {Point[] | null} A copy of the points, or null if the list or a point is malformed.
 */
function readPoints(points, max) {
    if (!Array.isArray(points) || points.length > max) {
        return null;
    }
    const valid = points.every(
        p =>
            Array.isArray(p) &&
            p.length === 3 &&
            isNumber(p[0]) &&
            isNumber(p[1]) &&
            isNumber(p[2]) &&
            p[2] >= 0 &&
            p[2] <= 1
    );
    return valid ? points.map(([x, y, pressure]) => [x, y, pressure]) : null;
}

/**
 * Read the fields of a received stroke.
 *
 * @param {any} data - The fields.
 * @param {number} maxPoints - The most points it may hold.
 * @returns {StrokeStart | null} The stroke, or null if a field is malformed.
 */
function readStrokeStart(data, maxPoints) {
    if (data === null || typeof data !== "object") {
        return null;
    }
    const {id, tool, color, width} = data;
    const points = readPoints(data.points, maxPoints);
    const valid =
        isId(id) &&
        Object.values(Tools).includes(tool) &&
        typeof color === "string" &&
        /^#[0-9a-f]{6}$/i.test(color) &&
        isNumber(width) &&
        width > 0 &&
        points !== null;
    return valid ? {id, tool, color, width, points: /** @type {Point[]} */ (points)} : null;
}

/**
 * Read a received stroke as the display holds it, in a `hello` or a `drawings`.
 *
 * @param {any} data - The fields.
 * @returns {Stroke | null} The stroke, or null if a field is malformed.
 */
function readStroke(data) {
    const stroke = readStrokeStart(data, MAX_STROKE_POINTS);
    return stroke && typeof data.done === "boolean" ? {...stroke, done: data.done} : null;
}

/**
 * Read received drawings, the `drawings` field of a display's `hello`.
 *
 * @param {any} data - The fields.
 * @returns {Drawings | null} The drawings, or null if a field or a stroke is malformed.
 */
export function readDrawings(data) {
    if (data === null || typeof data !== "object" || !Array.isArray(data.strokes)) {
        return null;
    }
    const strokes = data.strokes.map(readStroke);
    const valid = typeof data.visible === "boolean" && strokes.every(stroke => stroke !== null);
    return valid ? {visible: data.visible, strokes: /** @type {Stroke[]} */ (strokes)} : null;
}

/**
 * Read a received `strokeBegin`.
 *
 * @param {any} data - The message.
 * @returns {StrokeBeginMessage | null} The message, or null if a field is malformed.
 */
export function readStrokeBegin(data) {
    const stroke = readStrokeStart(data, MAX_POINTS_PER_MESSAGE);
    return stroke && strokeBeginMessage(stroke);
}

/**
 * Read a received `strokePoints`.
 *
 * @param {any} data - The message.
 * @returns {StrokePointsMessage | null} The message, or null if a field is malformed.
 */
export function readStrokePoints({id, points}) {
    const read = readPoints(points, MAX_POINTS_PER_MESSAGE);
    return isId(id) && read ? strokePointsMessage(id, read) : null;
}

/**
 * Read a received `strokeEnd`.
 *
 * @param {any} data - The message.
 * @returns {StrokeEndMessage | null} The message, or null for a malformed id.
 */
export function readStrokeEnd({id}) {
    return isId(id) ? strokeEndMessage(id) : null;
}

/**
 * Read a received `strokeErase`.
 *
 * @param {any} data - The message.
 * @returns {StrokeEraseMessage | null} The message, or null for a malformed id.
 */
export function readStrokeErase({id}) {
    return isId(id) ? strokeEraseMessage(id) : null;
}

/**
 * Read a received `drawingUndo`.
 *
 * @returns {DrawingUndoMessage} The message: it has no fields to check.
 */
export function readDrawingUndo() {
    return drawingUndoMessage();
}

/**
 * Read a received `drawingClear`.
 *
 * @returns {DrawingClearMessage} The message: it has no fields to check.
 */
export function readDrawingClear() {
    return drawingClearMessage();
}

/**
 * Read a received `drawingVisible`.
 *
 * @param {any} data - The message.
 * @returns {DrawingVisibleMessage | null} The message, or null without a boolean.
 */
export function readDrawingVisible({visible}) {
    return typeof visible === "boolean" ? drawingVisibleMessage(visible) : null;
}

/**
 * Read a received `drawings`.
 *
 * @param {any} data - The message.
 * @returns {DrawingsMessage | null} The message, or null if a field or a stroke is malformed.
 */
export function readDrawingsMessage(data) {
    const drawings = readDrawings(data);
    return drawings && drawingsMessage(drawings);
}
