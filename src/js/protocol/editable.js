/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Where a key belongs to the field it was typed into, for the deck and the surfaces alike.
 *
 * @module
 */

/** The input types a person types into; the others (buttons, boxes) take no text.
 *
 * @readonly
 */
const TEXT_INPUT_TYPES = Object.freeze([
    "text",
    "search",
    "email",
    "url",
    "tel",
    "password",
    "number",
    "date",
    "datetime-local",
    "month",
    "time",
    "week"
]);

/**
 * Does a person type into this element, so that its keys are not presentation keys?
 *
 * @param {any} target - The target of a key event, or null.
 * @returns {boolean} True for a text field, a text area, a list box or editable content.
 */
export function isEditableTarget(target) {
    if (!target) {
        return false;
    }
    switch (target.localName) {
        case "textarea":
        case "select":
            return true;
        case "input":
            return TEXT_INPUT_TYPES.includes(target.type);
        default:
            return target.isContentEditable === true;
    }
}

/**
 * The element that takes the focus for a click on this target, if the click lands in a field.
 *
 * A click on text nested in editable content gives the focus to the editing host, the
 * outermost editable ancestor, since a span inside it cannot take the focus itself.
 *
 * @param {any} target - The target of a pointer event, or null.
 * @returns {any} The target itself for a text field, a text area or a list box, the editing
 *     host for editable content, or null for anything else.
 */
export function editableField(target) {
    if (!isEditableTarget(target)) {
        return null;
    }
    let host = target;
    while (host.parentElement && host.parentElement.isContentEditable === true) {
        host = host.parentElement;
    }
    return host;
}
