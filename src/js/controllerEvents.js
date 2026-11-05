/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The names of the events a `Controller` emits.
 *
 * In a module of its own because `Storage` listens to the controller and
 * `Controller` imports `Storage`: a table in `Controller.js` would make an import cycle.
 *
 * @module
 */

/** The events a `Controller` emits (standard 2.4).
 *
 * @readonly
 */
export const ControllerEvents = Object.freeze({
    /** Signals that the current editor window has received the focus. */
    focus: "focus",
    /** Signals that the current editor window has lost the focus. */
    blur: "blur",
    /** Signals that the editor UI needs to be repainted. */
    repaint: "repaint",
    /** Signals that the presentation data has changed. */
    presentationChange: "presentationChange",
    /** Signals that the editor state data has changed. */
    editorStateChange: "editorStateChange"
});
