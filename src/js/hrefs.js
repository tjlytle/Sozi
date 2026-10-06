/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Rewriting of relative hrefs when the HTML of a presentation is written
 * in another directory than its SVG document.
 *
 * This module depends only on `path` so that it can be used by the editor,
 * the command-line mode and unit tests alike.
 *
 * @module
 */

import path from "path";

/** The namespace URI of Sozi elements and attributes. */
const SOZI_NS = "http://sozi.baierouge.fr";

/** Is an href relative to the directory of the document?
 *
 * A relative href is not empty, has no scheme (such as `data:` or `https:`)
 * and does not start with `/` or `#`.
 *
 * @param {string} href - The value of an href attribute.
 * @returns {boolean} - `true` if the href is relative.
 */
export function isRelativeHref(href) {
    const value = href.trim();
    return value !== "" && !/^[a-z][a-z0-9+.-]*:|^[/#]/i.test(value);
}

/** Escape a string for a regular expression.
 *
 * @param {string} str - Any string.
 * @returns {string} - The string with its special characters escaped.
 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrite the relative image and media hrefs of an SVG document.
 *
 * The hrefs rewritten are the `href` and `xlink:href` (with any prefix)
 * attributes of `<image>` elements and the `src` attributes of the Sozi
 * namespace (`sozi:src` on media elements), when they are relative
 * (see {@linkcode module:hrefs.isRelativeHref|isRelativeHref}).
 * A relative href `h` becomes `path.relative(outDir, path.join(svgDir, h))`
 * with forward slashes, so that it resolves from `outDir` to the same file.
 * Other hrefs are untouched. The text is returned unchanged when both
 * directories are the same.
 *
 * @param {string} svgText - The serialized SVG document.
 * @param {string} svgDir - The directory of the SVG file.
 * @param {string} outDir - The directory of the HTML file.
 * @returns {string} - The SVG document with its relative hrefs rewritten.
 */
export function rewriteRelativeHrefs(svgText, svgDir, outDir) {
    if (path.resolve(svgDir) === path.resolve(outDir)) {
        return svgText;
    }

    function rebase(match, before, quote, href) {
        if (!isRelativeHref(href)) {
            return match;
        }
        // The value is kept escaped: escaped characters are not path separators.
        const target = path.relative(outDir, path.join(svgDir, href.trim())).split(path.sep).join("/");
        return before + quote + target + quote;
    }

    // href and xlink:href of image elements.
    let result = svgText.replace(/<(?:[\w.-]+:)?image\b[^>]*>/g, tag =>
        tag.replace(/(\s(?:[\w.-]+:)?href\s*=\s*)(["'])(.*?)\2/g, rebase));

    // src attributes in the Sozi namespace, with any declared prefix.
    const soziNs = new RegExp(`\\sxmlns:([\\w.-]+)\\s*=\\s*(["'])${escapeRegExp(SOZI_NS)}\\2`, "g");
    for (const [, prefix] of svgText.matchAll(soziNs)) {
        const src = new RegExp(`(\\s${escapeRegExp(prefix)}:src\\s*=\\s*)(["'])(.*?)\\2`, "g");
        result = result.replace(src, rebase);
    }

    return result;
}
