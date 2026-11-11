/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {addSVGHandler, DefaultSVGHandler} from "./SVGDocumentWrapper";
import {pageBackground} from "./pageBackground";

/** The XML namespace URI of Inkscape.
 *
 * @readonly
 * @default
 * @type {string}
 */
const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";

/** The XML namespace URI of Sodipodi.
 *
 * @readonly
 * @default
 * @type {string}
 */
const SODIPODI_NS = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd";

/** Inkscape SVG handler.
 *
 * @extends DefaultSVGHandler
 */
export class InkscapeHandler extends DefaultSVGHandler {
    /** @inheritdoc */
    static matches(svgRoot) {
        return svgRoot.getAttribute("xmlns:inkscape") === INKSCAPE_NS;
    }

    /** @inheritdoc */
    static transform(svgRoot) {
        let pageColor = "#ffffff";
        let pageOpacity = "0";

        // Get page color and opacity from Inkscape document properties
        const namedViews = svgRoot.getElementsByTagNameNS(SODIPODI_NS, "namedview");
        for (let i = 0; i < namedViews.length; i++) {
            if (namedViews[i].hasAttribute("pagecolor")) {
                pageColor = namedViews[i].getAttribute("pagecolor");
                if (namedViews[i].hasAttributeNS(INKSCAPE_NS, "pageopacity")) {
                    pageOpacity = namedViews[i].getAttributeNS(INKSCAPE_NS, "pageopacity");
                }
                break;
            }
        }

        // A page colour that is not hex leaves Sozi's default background.
        const background = pageBackground(pageColor, pageOpacity);
        if (background === null) {
            return;
        }

        const style = document.createElement("style");
        style.textContent = `svg {
            background: ${background};
        }`;
        svgRoot.insertBefore(style, svgRoot.firstChild);
    }

    /** @inheritdoc */
    static isLayer(svgElement) {
        return svgElement.getAttribute("inkscape:groupmode") === "layer";
    }

    /** @inheritdoc */
    static getLabel(svgElement) {
        return svgElement.getAttribute("inkscape:label");
    }
}

addSVGHandler("Inkscape", InkscapeHandler);
