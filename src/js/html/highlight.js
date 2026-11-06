/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Highlight the code in notes. Only the languages registered here go in the bundle.
 *
 * @module
 */

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import {setSanitizedHTML} from "./sanitize.js";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("php", php);
hljs.registerLanguage("python", python);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

/** Highlight each `pre code` under an element that names a language it knows.
 *
 * Code in an unknown language, or in none, stays plain.
 *
 * @param {Element} element - The element holding the code.
 */
export function highlightCode(element) {
    for (const code of element.querySelectorAll("pre code")) {
        const match = /(?:^|\s)language-(\S+)/.exec(code.className);
        if (match && hljs.getLanguage(match[1])) {
            const text = code.textContent || "";
            setSanitizedHTML(code, hljs.highlight(text, {language: match[1]}).value);
        }
    }
}
