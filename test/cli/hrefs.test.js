/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Unit tests of the href rewriter used when the HTML is written in another
// directory than the SVG. They load the module directly, without Electron.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {rewriteRelativeHrefs, isRelativeHref} = require(path.resolve(__dirname, "..", "..", "src", "js", "hrefs.js"));

const XLINK = "xmlns:xlink=\"http://www.w3.org/1999/xlink\"";
const SOZI  = "xmlns:sozi=\"http://sozi.baierouge.fr\"";

/** An SVG document with the given content and the xlink and sozi namespaces. */
function svg(content) {
    return `<svg xmlns="http://www.w3.org/2000/svg" ${XLINK} ${SOZI}>${content}</svg>`;
}

describe("isRelativeHref", () => {
    test("relative paths are relative", () => {
        for (const href of ["img/a.png", "a.png", "./a.png", "../a.png", "my%20pic.png", "a.svg#frag"]) {
            assert.equal(isRelativeHref(href), true, href);
        }
    });

    test("absolute paths, scheme, fragment and data URLs, and empty hrefs are not", () => {
        for (const href of ["/abs/a.png", "#id", "http://x.org/a.png", "https://x.org/a.png",
            "data:image/png;base64,AAAA", "file:///a.png", "HTTP://X.ORG/A.PNG", "", "  "]) {
            assert.equal(isRelativeHref(href), false, href);
        }
    });
});

describe("rewriteRelativeHrefs", () => {
    test("the same directory: the text is returned unchanged", () => {
        const text = svg("<image xlink:href=\"img/a.png\"/>");
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d"), text);
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/"), text);
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/x/.."), text);
    });

    test("output directory below the SVG directory: hrefs go up", () => {
        const text = svg("<image xlink:href=\"img/a.png\"/>");
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/site/talk"),
            svg("<image xlink:href=\"../../img/a.png\"/>"));
    });

    test("output directory above the SVG directory: hrefs go down", () => {
        const text = svg("<image xlink:href=\"img/a.png\"/>");
        assert.equal(rewriteRelativeHrefs(text, "/d/src/deck", "/d"),
            svg("<image xlink:href=\"src/deck/img/a.png\"/>"));
    });

    test("a sibling output directory and an href that goes up", () => {
        const text = svg("<image xlink:href=\"../shared/a.png\"/>");
        assert.equal(rewriteRelativeHrefs(text, "/d/src", "/d/out"),
            svg("<image xlink:href=\"../shared/a.png\"/>"));
        assert.equal(rewriteRelativeHrefs(text, "/d/src", "/d/out/x"),
            svg("<image xlink:href=\"../../shared/a.png\"/>"));
    });

    test("an href that becomes a bare file name", () => {
        const text = svg("<image xlink:href=\"site/a.png\"/>");
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/site"),
            svg("<image xlink:href=\"a.png\"/>"));
    });

    test("plain href and xlink:href with any prefix", () => {
        const text = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xl="http://www.w3.org/1999/xlink">` +
            "<image href=\"a.png\"/><image x=\"0\" xl:href=\"b.png\" y=\"0\"/></svg>";
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/out"),
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xl="http://www.w3.org/1999/xlink">` +
            "<image href=\"../a.png\"/><image x=\"0\" xl:href=\"../b.png\" y=\"0\"/></svg>");
    });

    test("single-quoted attribute values", () => {
        const text = svg("<image xlink:href='a.png'/>");
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/out"), svg("<image xlink:href='../a.png'/>"));
    });

    test("absolute, scheme, fragment and data hrefs are untouched", () => {
        const text = svg(
            "<image xlink:href=\"/abs/a.png\"/>" +
            "<image xlink:href=\"http://x.org/a.png\"/>" +
            "<image href=\"https://x.org/a.png\"/>" +
            "<image xlink:href=\"#id\"/>" +
            "<image xlink:href=\"data:image/png;base64,iVBORw0KGgo=\"/>" +
            "<sozi:video sozi:src=\"https://x.org/v.webm\"/>" +
            "<sozi:audio sozi:src=\"/abs/a.ogg\"/>");
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/out"), text);
    });

    test("sozi:src of media elements, with any prefix of the Sozi namespace", () => {
        const text = svg("<rect><sozi:video sozi:type=\"video/webm\" sozi:src=\"media/v.webm\"/></rect>");
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/out"),
            svg("<rect><sozi:video sozi:type=\"video/webm\" sozi:src=\"../media/v.webm\"/></rect>"));

        const other = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:ns1=\"http://sozi.baierouge.fr\">" +
            "<ns1:audio ns1:src=\"a.ogg\"/></svg>";
        assert.equal(rewriteRelativeHrefs(other, "/d", "/d/out"),
            "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:ns1=\"http://sozi.baierouge.fr\">" +
            "<ns1:audio ns1:src=\"../a.ogg\"/></svg>");
    });

    test("a namespace declared several times: each sozi:src is rebased once", () => {
        const ns = "xmlns:sozi=\"http://sozi.baierouge.fr\"";
        const same = `<svg xmlns="http://www.w3.org/2000/svg"><sozi:video ${ns} sozi:src="m/v.webm"/>` +
            `<sozi:video ${ns} sozi:src="m/w.webm"/></svg>`;
        assert.equal(rewriteRelativeHrefs(same, "/d", "/d/out"),
            `<svg xmlns="http://www.w3.org/2000/svg"><sozi:video ${ns} sozi:src="../m/v.webm"/>` +
            `<sozi:video ${ns} sozi:src="../m/w.webm"/></svg>`);

        const two = "<svg xmlns=\"http://www.w3.org/2000/svg\">" +
            "<a:video xmlns:a=\"http://sozi.baierouge.fr\" a:src=\"v.webm\"/>" +
            "<b:audio xmlns:b=\"http://sozi.baierouge.fr\" b:src=\"a.ogg\"/></svg>";
        assert.equal(rewriteRelativeHrefs(two, "/d", "/d/out"),
            "<svg xmlns=\"http://www.w3.org/2000/svg\">" +
            "<a:video xmlns:a=\"http://sozi.baierouge.fr\" a:src=\"../v.webm\"/>" +
            "<b:audio xmlns:b=\"http://sozi.baierouge.fr\" b:src=\"../a.ogg\"/></svg>");
    });

    test("hrefs of other elements and src of other namespaces are untouched", () => {
        const text = svg("<a xlink:href=\"page.html\"><use xlink:href=\"lib.svg#x\"/></a><foo:x foo:src=\"a.png\"/>");
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/out"), text);
    });

    test("elements whose name only starts with image are untouched", () => {
        const text = svg("<image-foo href=\"a.png\"/><x:image-set xlink:href=\"b.png\"/><imagex href=\"c.png\"/>");
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/out"), text);
        // An image element with no attribute before its end, or a self-closing one, still matches.
        assert.equal(rewriteRelativeHrefs(svg("<image\nxlink:href=\"a.png\"/>"), "/d", "/d/out"),
            svg("<image\nxlink:href=\"../a.png\"/>"));
    });

    test("every image is rewritten", () => {
        const text = svg("<image xlink:href=\"a.png\"/><g><image xlink:href=\"b/c.png\"/></g>");
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/out"),
            svg("<image xlink:href=\"../a.png\"/><g><image xlink:href=\"../b/c.png\"/></g>"));
    });

    test("escaped characters are kept escaped", () => {
        const text = svg("<image xlink:href=\"a&amp;b.png\"/>");
        assert.equal(rewriteRelativeHrefs(text, "/d", "/d/out"), svg("<image xlink:href=\"../a&amp;b.png\"/>"));
    });
});
