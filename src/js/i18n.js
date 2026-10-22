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

/** Initialize the internationalization support in the current editor.
 *
 * In autodection mode, this function will query the web browser for the
 * current language.
 *
 * @param {string} lang - A language tag to use, or `"auto"`.
 * @returns {Jed} - An instance of `Jed` that provides the `gettext` function.
 */
export function init(lang = "auto") {
    let requestedLang = lang;
    if (lang === "auto") {
        requestedLang =
            window.navigator.languages && window.navigator.languages.length
                ? window.navigator.languages[0]
                : window.navigator.language || window.navigator.userLanguage || "en";
    }

    // Normalize the given language tag and extract the language code alone
    const langTag = normalize(requestedLang);
    const langShort = langTag.split("-")[0];

    // Find the user language in the available locales
    const allLanguages = Object.keys(locales).map(normalize);
    let langIndex = allLanguages.indexOf(langTag);
    if (langIndex < 0) {
        langIndex = allLanguages.indexOf(langShort);
    }

    const localeData = langIndex >= 0 ? locales[Object.keys(locales)[langIndex]] : {};

    return new Jed(localeData);
}
