/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

/** The address schemes a pairing link's deck may have.
 *
 * @readonly
 */
const DECK_PROTOCOLS = Object.freeze(["http:", "https:"]);

/**
 * What a pairing link says.
 *
 * @typedef {object} ShellLink
 * @property {string} deck - The published deck's address.
 * @property {string} session - The session to join.
 * @property {Record<string, string>} params - Every other field, for the add-on.
 */

/** Read the fragment of the hosted shell's address as a pairing link.
 *
 * @param {string} hash - The fragment, as `location.hash` gives it.
 * @returns {?ShellLink} The link, null for an empty fragment.
 * @throws {TypeError} If it has no session, or its deck is not an `http:` or `https:` URL.
 */
export function readShellLink(hash) {
    const text = hash.replace(/^#/, "");
    if (!text) {
        return null;
    }
    const {deck, session, ...params} = Object.fromEntries(new URLSearchParams(text));
    if (!session) {
        throw new TypeError("A pairing link needs a session");
    }
    // The URL constructor throws a TypeError of its own for a relative address.
    const url = new URL(deck);
    if (!DECK_PROTOCOLS.includes(url.protocol)) {
        throw new TypeError(`A pairing link's deck cannot be a ${url.protocol} address`);
    }
    return {deck: url.href, session, params};
}
