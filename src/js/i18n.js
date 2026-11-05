/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Internationalization support in the presentation editor.
 *
 * @module
 */

import Jed from "jed";
import locales from "./locales";

/** Convert a language tag to a dash-separated lowercase string.
 *
 * @param {string} tag - A language tag.
 * @returns {string} - The same language tag, dash-separated lowercase.
 */
function normalize(tag) {
    return tag.replace(/_/g, "-").toLowerCase();
}

/** Choose the available locale for a language setting.
 *
 * `"auto"` stands for the first system language, or English when there is none.
 * A regional tag falls back to its language.
 *
 * @param {string} lang - A language tag, or `"auto"`.
 * @param {string[]} systemLanguages - The languages of the system, preferred first.
 * @param {object} available - The locales, keyed by language tag.
 * @returns {?string} - The key in `available` that matches, or `null`.
 */
export function chooseLanguage(lang, systemLanguages, available) {
    // No `??` here: jspot's parser, which extracts the strings to translate, predates it.
    const langTag = normalize(lang === "auto" ? systemLanguages[0] || "en" : lang);
    const langShort = langTag.split("-")[0];
    const keys = Object.keys(available);
    return (
        keys.find(key => normalize(key) === langTag) ||
        keys.find(key => normalize(key) === langShort) ||
        null
    );
}

/** Initialize the internationalization support in the current editor.
 *
 * @param {string} lang - A language tag to use, or `"auto"`.
 * @param {string[]} systemLanguages - The languages of the system, preferred first.
 * @returns {Jed} - An instance of `Jed` that provides the `gettext` function.
 */
export function init(lang, systemLanguages) {
    const key = chooseLanguage(lang, systemLanguages, locales);
    return new Jed(key === null ? {} : locales[key]);
}
