import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    documentMarkdown,
    overlayNotes,
    pairSections,
    parseSections,
    sectionHtml
} from "../../../src/js/notes/notesDocument.js";

/** A frame as the presentation file holds it.
 *
 * @param {string} frameId - Its id.
 * @param {string} title - Its title.
 * @param {string} [notes] - Its notes, as HTML.
 * @returns {{frameId: string, title: string, notes: string}} - The frame.
 */
function frame(frameId, title, notes = "") {
    return {frameId, title, notes};
}

/** The notes as they are, standing in for the HTML to Markdown conversion.
 *
 * @param {string} html - The notes.
 * @returns {string} - The same text.
 */
const asMarkdown = html => html;

describe("parseSections", () => {
    test("splits on depth-1 headings, keeping each body", () => {
        const sections = parseSections(
            "# One\n\nFirst.\n\n## Inner\n\nMore.\n\n# Two\n\nSecond.\n"
        );
        assert.deepEqual(sections, [
            {title: "One", frameId: null, body: "First.\n\n## Inner\n\nMore."},
            {title: "Two", frameId: null, body: "Second."}
        ]);
    });

    test("a # in a fence stays text", () => {
        const sections = parseSections("# One\n\n```bash\n# a comment\n```\n");
        assert.equal(sections.length, 1);
        assert.equal(sections[0].body, "```bash\n# a comment\n```");
    });

    test("a # in a quote does not start a section", () => {
        assert.equal(parseSections("# One\n\n> # Quoted\n").length, 1);
    });

    test("a setext heading starts a section", () => {
        assert.deepEqual(parseSections("One\n===\n\nFirst.\n"), [
            {title: "One", frameId: null, body: "First."}
        ]);
    });

    test("reads the pin under a heading and leaves it out of the body", () => {
        assert.deepEqual(parseSections("# One\n\n<!-- frame: frame-7 -->\n\nFirst.\n"), [
            {title: "One", frameId: "frame-7", body: "First."}
        ]);
    });

    test("a comment that is not a pin stays in the body", () => {
        assert.equal(parseSections("# One\n\n<!-- to do -->\n")[0].frameId, null);
    });

    test("text before the first heading is a section with no title", () => {
        assert.deepEqual(parseSections("Hello.\n\n# One\n"), [
            {title: null, frameId: null, body: "Hello."},
            {title: "One", frameId: null, body: ""}
        ]);
    });

    test("blank text before the first heading is no section", () => {
        assert.equal(parseSections("\n\n# One\n").length, 1);
    });

    test("a heading's title is its plain text", () => {
        assert.equal(parseSections("# A \\* b `c` *d*\n")[0].title, "A * b c d");
    });

    test("Windows line ends do not reach the body", () => {
        assert.equal(parseSections("# One\r\n\r\nA\r\nB\r\n")[0].body, "A\nB");
    });
});

describe("pairSections", () => {
    const frames = [frame("f1", "One"), frame("f2", "Two"), frame("f3", "Three")];

    test("pairs by title, and says what did not pair", () => {
        const sections = parseSections("# One\n\n# Nowhere\n");
        const {pairs, unmatchedHeadings, unmatchedFrames} = pairSections(sections, frames);
        assert.deepEqual(
            pairs.map(pair => [pair.section.title, pair.frame.frameId]),
            [["One", "f1"]]
        );
        assert.deepEqual(unmatchedHeadings, ["Nowhere"]);
        assert.deepEqual(
            unmatchedFrames.map(f => f.frameId),
            ["f2", "f3"]
        );
    });

    test("a pin goes before a title, and a renamed heading still pairs", () => {
        const sections = parseSections("# Two\n\n# Renamed\n\n<!-- frame: f2 -->\n");
        const {pairs, unmatchedHeadings} = pairSections(sections, frames);
        assert.deepEqual(
            pairs.map(pair => [pair.section.title, pair.frame.frameId]),
            [["Renamed", "f2"]]
        );
        assert.deepEqual(unmatchedHeadings, ["Two"]);
    });

    test("a pin to no frame falls back to the title", () => {
        const sections = parseSections("# One\n\n<!-- frame: gone -->\n");
        assert.equal(pairSections(sections, frames).pairs[0].frame.frameId, "f1");
    });

    test("duplicate titles pair in deck order", () => {
        const twins = [frame("a", "Same"), frame("b", "Other"), frame("c", "Same")];
        const {pairs, unmatchedHeadings} = pairSections(
            parseSections("# Same\n\nA.\n\n# Same\n\nC.\n\n# Same\n\nExtra.\n"),
            twins
        );
        assert.deepEqual(
            pairs.map(pair => [pair.section.body, pair.frame.frameId]),
            [
                ["A.", "a"],
                ["C.", "c"]
            ]
        );
        assert.deepEqual(unmatchedHeadings, ["Same"]);
    });

    test("two sections pinning one frame: the first has it, the second is unmatched", () => {
        const sections = parseSections(
            "# First\n\n<!-- frame: f1 -->\n\n# Second\n\n<!-- frame: f1 -->\n"
        );
        const {pairs, unmatchedHeadings} = pairSections(sections, frames);
        assert.deepEqual(
            pairs.map(pair => pair.section.title),
            ["First"]
        );
        assert.deepEqual(unmatchedHeadings, ["Second"]);
    });

    test("an (untitled) heading pairs with a frame with an empty title", () => {
        const {pairs} = pairSections(parseSections("# (untitled)\n"), [frame("e", "  ")]);
        assert.equal(pairs[0].frame.frameId, "e");
    });

    test("text before the first heading is reported, not paired", () => {
        const {pairs, unmatchedHeadings} = pairSections(parseSections("Hello.\n"), frames);
        assert.deepEqual(pairs, []);
        assert.deepEqual(unmatchedHeadings, ["(text before the first heading)"]);
    });
});

describe("sectionHtml", () => {
    test("promotes headings by one level, so that ## is a notes h1", () => {
        const html = sectionHtml({body: "## Big\n\n### Small\n"});
        assert.match(html, /<h1>Big<\/h1>/);
        assert.match(html, /<h2>Small<\/h2>/);
    });

    test("renders tables, strikethrough and fenced code", () => {
        const html = sectionHtml({
            body: "| a |\n| - |\n| 1 |\n\n~~gone~~\n\n```js\nlet x;\n```\n"
        });
        assert.match(html, /<table>/);
        assert.match(html, /<s>gone<\/s>/);
        assert.match(html, /<code class="language-js">/);
    });

    test("renders task lists as checkboxes", () => {
        const html = sectionHtml({body: "- [x] Done\n- [ ] Still\n- Plain\n"});
        assert.match(html, /<input type="checkbox" disabled checked> ?Done/);
        assert.match(html, /<input type="checkbox" disabled> ?Still/);
        assert.equal(html.split("<input").length - 1, 2);
    });

    test("an empty body is empty notes", () => {
        assert.equal(sectionHtml({body: ""}), "");
    });
});

describe("documentMarkdown", () => {
    test("a heading per frame with notes, in deck order", () => {
        const text = documentMarkdown(
            [frame("f1", "One", "First."), frame("f2", "Two"), frame("f3", "Three", "Third.")],
            asMarkdown
        );
        assert.equal(text, "# One\n\nFirst.\n\n# Three\n\nThird.\n");
    });

    test("notes that convert to nothing add nothing", () => {
        const text = documentMarkdown([frame("f1", "One", "  \n ")], asMarkdown);
        assert.equal(text, "");
    });

    test("a repeated title is pinned, on every frame that has it", () => {
        const text = documentMarkdown(
            [frame("a", "Same", "A."), frame("b", "Same", "B."), frame("c", "Other", "C.")],
            asMarkdown
        );
        assert.equal(
            text,
            "# Same\n\n<!-- frame: a -->\n\nA.\n\n# Same\n\n<!-- frame: b -->\n\nB.\n\n# Other\n\nC.\n"
        );
    });

    test("a title repeated by a frame with no notes still pins", () => {
        const text = documentMarkdown([frame("a", "Same"), frame("b", "Same", "B.")], asMarkdown);
        assert.match(text, /<!-- frame: b -->/);
    });

    test("an empty title reads (untitled) and is pinned", () => {
        assert.equal(
            documentMarkdown([frame("e", "", "E.")], asMarkdown),
            "# (untitled)\n\n<!-- frame: e -->\n\nE.\n"
        );
    });

    test("a title's Markdown characters are escaped and read back", () => {
        const title = "C# & *stars* [x] `tick` <b> ##";
        const text = documentMarkdown([frame("f", title, "Text.")], asMarkdown);
        assert.equal(parseSections(text)[0].title, title);
    });

    test("export then parse pairs every frame that has notes, with its own body", () => {
        const frames = [
            frame("a", "One", "A."),
            frame("b", "Same", "B.\n\n```\n# not a heading\n```"),
            frame("c", "Same", "C."),
            frame("d", "", "D."),
            frame("e", "1. *Odd* title #", "E."),
            frame("f", "No notes")
        ];
        const {pairs, unmatchedHeadings, unmatchedFrames} = pairSections(
            parseSections(documentMarkdown(frames, asMarkdown)),
            frames
        );
        assert.deepEqual(unmatchedHeadings, []);
        assert.deepEqual(
            unmatchedFrames.map(f => f.frameId),
            ["f"]
        );
        for (const {section, frame: paired} of pairs) {
            assert.equal(section.body, paired.notes);
        }
        assert.equal(pairs.length, 5);
    });
});

describe("overlayNotes", () => {
    const frames = [
        frame("f1", "One", "<p>json one</p>"),
        frame("f2", "Two", "<p>json two</p>"),
        frame("f3", "Three", "<p>json three</p>")
    ];

    test("puts the file's notes in the frames and leaves the rest of each frame", () => {
        const extra = {...frames[0], timeoutMs: 5};
        const {frames: result} = overlayNotes([extra], "# One\n\nfrom file\n");
        assert.equal(result[0].timeoutMs, 5);
        assert.match(result[0].notes, /from file/);
    });

    test("does not change the frames it is given", () => {
        overlayNotes(frames, "# One\n\nfrom file\n");
        assert.equal(frames[0].notes, "<p>json one</p>");
    });

    test("a file wins whole: a frame it does not name has no notes", () => {
        const {frames: result, unmatchedFrames} = overlayNotes(frames, "# One\n\nfrom file\n");
        assert.equal(result[1].notes, "");
        assert.deepEqual(
            unmatchedFrames.map(f => f.frameId),
            ["f2", "f3"]
        );
    });

    test("an unmatched section shows under the section before it, with its heading", () => {
        const {frames: result, unmatchedHeadings} = overlayNotes(
            frames,
            "# One\n\nfirst\n\n# Nowhere\n\nstray\n\n# Two\n\nsecond\n"
        );
        assert.match(result[0].notes, /first/);
        assert.match(result[0].notes, /<h1>Nowhere<\/h1>/);
        assert.match(result[0].notes, /stray/);
        assert.doesNotMatch(result[1].notes, /stray/);
        assert.deepEqual(unmatchedHeadings, ["Nowhere"]);
    });

    test("text before the first heading shows in the first section", () => {
        const {frames: result, unmatchedHeadings} = overlayNotes(
            frames,
            "preamble\n\n# Two\n\nsecond\n"
        );
        assert.equal(result[0].notes, "");
        assert.match(result[1].notes, /preamble[\s\S]*second/);
        assert.deepEqual(unmatchedHeadings, ["(text before the first heading)"]);
    });

    test("a file with no pair at all still shows, on the deck's first frame", () => {
        const {frames: result} = overlayNotes(frames, "# Nowhere\n\nstray\n");
        assert.match(result[0].notes, /stray/);
    });

    test("a deck with no frames has nothing to show it on", () => {
        assert.deepEqual(overlayNotes([], "# Nowhere\n").frames, []);
    });

    test("the file's script stays in the HTML for the sanitizer to remove at the surface", () => {
        const {frames: result} = overlayNotes(frames, "# One\n\n<script>x()</script>\n");
        assert.match(result[0].notes, /<script>/);
    });
});
