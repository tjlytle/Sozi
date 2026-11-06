/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {runSozi, withTempDeck} = require("./helpers.js");

/** @typedef {import("./helpers.js").Deck} Deck */
/** @typedef {import("./helpers.js").SoziRun} SoziRun */

/** Run a test on a fresh copy of a fixture.
 *
 * @param {string} fixture - The fixture name.
 * @param {(deck: Deck) => void} body - The test.
 */
function withDeck(fixture, body) {
    const deck = withTempDeck(fixture);
    try {
        body(deck);
    } finally {
        deck.cleanup();
    }
}

/** Run `notes` in a deck's directory.
 *
 * @param {Deck} deck - The deck.
 * @param {...string} args - The arguments after `notes`.
 * @returns {SoziRun} - The result of the run.
 */
function notes(deck, ...args) {
    return runSozi(["notes", ...args], {cwd: deck.dir});
}

/** Export a deck's notes to a file beside it, under a name the presenter does not read.
 *
 * @param {Deck} deck - The deck.
 * @returns {{file: string, text: string}} - The file and what it holds.
 */
function exported(deck) {
    const run = notes(deck, "export", path.basename(deck.json), "edit.md");
    assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
    const file = path.join(deck.dir, "edit.md");
    return {file, text: fs.readFileSync(file, "utf8")};
}

/** Give a deck a file's text, edit the section of its frame Six, and compare the text it ends with.
 *
 * @param {Deck} deck - The deck.
 * @param {string} before - The presentation file's text.
 */
function assertOnlySixChanges(deck, before) {
    fs.writeFileSync(deck.json, before);
    const {file, text} = exported(deck);
    fs.writeFileSync(file, text.replace("Second short line.", "Second, edited."));

    const {code, json} = notes(deck, "import", path.basename(deck.json), "edit.md");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.changed, ["frame6"]);

    const edited = "<p>First short line.</p>\n<p>Second, edited.</p>\n";
    const old = JSON.stringify(JSON.parse(before).frames[5].notes);
    assert.equal(
        fs.readFileSync(deck.json, "utf8"),
        before.replace(old, () => JSON.stringify(edited))
    );
}

describe("notes export", () => {
    test("returns the document in the result when no file is named", () => {
        withDeck("notes-document", deck => {
            const {code, json} = notes(deck, "export", path.basename(deck.json));
            assert.equal(code, 0);
            assert.equal(json.ok, true);
            assert.equal(json.command, "notes");
            assert.deepEqual(json.files, []);
            assert.deepEqual(
                json.markdown.split("\n").filter(line => /^# /.test(line)),
                ["# One", "# Four", "# Six"]
            );
            assert.deepEqual(
                fs.readdirSync(deck.dir).filter(name => name.endsWith(".md")),
                []
            );
        });
    });

    test("writes the document to a named file, and not in the result", () => {
        withDeck("notes-document", deck => {
            const {code, json} = notes(deck, "export", path.basename(deck.json), "out.md");
            const file = path.join(deck.dir, "out.md");
            assert.equal(code, 0);
            assert.deepEqual(json.files, [file]);
            assert.equal(json.markdown, undefined);
            assert.match(fs.readFileSync(file, "utf8"), /^# One\n/);
        });
    });

    test("writes tables, task lists, fences, links and images as Markdown", () => {
        withDeck("notes-document", deck => {
            const {json} = notes(deck, "export", path.basename(deck.json));
            assert.match(
                json.markdown,
                /\| Name \| Value \|\n\| --- \| --- \|\n\| answer \| 42 \|/
            );
            assert.match(json.markdown, /\[x\] Done/);
            assert.match(json.markdown, /\[ \] Still to do/);
            assert.match(json.markdown, /```javascript\nconst answer = 42;/);
            assert.match(json.markdown, /\[link\]\(https:\/\/example\.org\)/);
            assert.match(json.markdown, /!\[A dot\]\(data:image\/gif/);
        });
    });
});

describe("notes import", () => {
    test("export, edit one body, import: only that frame's notes differ", () => {
        withDeck("notes-document", deck => {
            const before = fs.readFileSync(deck.json, "utf8");
            const {file, text} = exported(deck);
            fs.writeFileSync(file, text.replace("Second short line.", "Second, edited."));

            const {code, json} = notes(deck, "import", path.basename(deck.json), "edit.md");
            assert.equal(code, 0, JSON.stringify(json));
            assert.deepEqual(json.changed, ["frame6"]);
            assert.deepEqual(json.files, [deck.json]);

            const after = fs.readFileSync(deck.json, "utf8");
            const notesOf = data => JSON.parse(data).frames.map(frame => frame.notes);
            const [oldNotes, newNotes] = [notesOf(before), notesOf(after)];
            assert.deepEqual(newNotes.slice(0, 5), oldNotes.slice(0, 5));
            assert.equal(newNotes[5], "<p>First short line.</p>\n<p>Second, edited.</p>\n");

            // Every other byte equal: put the old notes back and compare the text.
            const encoded = html => JSON.stringify(html);
            assert.equal(after.replace(encoded(newNotes[5]), encoded(oldNotes[5])), before);
        });
    });

    test("a file in another format keeps it: only the edited notes differ", () => {
        withDeck("notes-document", deck => {
            const parsed = JSON.parse(fs.readFileSync(deck.json, "utf8"));
            assertOnlySixChanges(
                deck,
                JSON.stringify(parsed, null, "\t").replace(/\n/g, "\r\n") + "\r\n\r\n"
            );
        });
    });

    test("an untouched frame without title or notes stays without them", () => {
        withDeck("notes-document", deck => {
            const parsed = JSON.parse(fs.readFileSync(deck.json, "utf8"));
            delete parsed.frames[1].title;
            delete parsed.frames[1].notes;
            assertOnlySixChanges(deck, JSON.stringify(parsed, null, "  ") + "\n");
        });
    });

    test("a section for a frame with no notes field adds only that field", () => {
        withDeck("notes-document", deck => {
            const parsed = JSON.parse(fs.readFileSync(deck.json, "utf8"));
            const title = parsed.frames[1].title;
            delete parsed.frames[1].notes;
            fs.writeFileSync(deck.json, JSON.stringify(parsed, null, "  ") + "\n");
            fs.writeFileSync(path.join(deck.dir, "edit.md"), `# ${title}\n\nnew\n`);

            const {code, json} = notes(deck, "import", path.basename(deck.json), "edit.md");
            assert.equal(code, 0, JSON.stringify(json));
            assert.deepEqual(json.changed, [parsed.frames[1].frameId]);

            const after = JSON.parse(fs.readFileSync(deck.json, "utf8"));
            parsed.frames[1].notes = "<p>new</p>\n";
            assert.deepEqual(after, parsed);
        });
    });

    test("with nothing edited, writes no file", () => {
        withDeck("notes-document", deck => {
            const before = fs.readFileSync(deck.json, "utf8");
            exported(deck);
            const {code, json} = notes(deck, "import", path.basename(deck.json), "edit.md");
            assert.equal(code, 0);
            assert.deepEqual(json.changed, []);
            assert.deepEqual(json.files, []);
            assert.equal(fs.readFileSync(deck.json, "utf8"), before);
        });
    });

    test("reports unmatched headings and frames, keeps those frames, and exits 0", () => {
        withDeck("notes-document", deck => {
            const before = JSON.parse(fs.readFileSync(deck.json, "utf8"));
            fs.writeFileSync(
                path.join(deck.dir, "edit.md"),
                "# Nowhere\n\nstray\n\n# Six\n\nnew\n"
            );

            const {code, json} = notes(deck, "import", path.basename(deck.json), "edit.md");
            assert.equal(code, 0, JSON.stringify(json));
            assert.equal(json.ok, true);
            assert.deepEqual(json.changed, ["frame6"]);
            assert.deepEqual(json.unmatched.headings, ["Nowhere"]);
            // Only the frames that have notes: an empty frame loses nothing.
            assert.deepEqual(json.unmatched.frames, ["One", "Four"]);
            assert.ok(json.warnings.some(warning => warning.includes("Nowhere")));
            assert.ok(json.warnings.some(warning => warning.includes("Four")));

            const after = JSON.parse(fs.readFileSync(deck.json, "utf8"));
            assert.equal(after.frames[0].notes, before.frames[0].notes);
            assert.equal(after.frames[3].notes, before.frames[3].notes);
            assert.equal(after.frames[5].notes, "<p>new</p>\n");
        });
    });

    test("a notes file beside the deck warns that the presenter shows it", () => {
        withDeck("notes-file", deck => {
            fs.writeFileSync(path.join(deck.dir, "edit.md"), "# One\n\nedited\n");
            const {code, json} = notes(deck, "import", path.basename(deck.json), "edit.md");
            assert.equal(code, 0);
            assert.ok(
                json.warnings.some(warning => warning.includes("notes-file.notes.md")),
                JSON.stringify(json.warnings)
            );
        });
    });

    test("no notes file beside the deck, no such warning", () => {
        withDeck("notes-document", deck => {
            exported(deck);
            const {json} = notes(deck, "import", path.basename(deck.json), "edit.md");
            assert.deepEqual(json.warnings, []);
        });
    });
});

describe("notes usage", () => {
    test("a bad action exits 2", () => {
        withDeck("notes-document", deck => {
            const {code, json} = notes(deck, "publish", path.basename(deck.json));
            assert.equal(code, 2);
            assert.match(json.error, /publish/);
        });
    });

    test("import with no Markdown file exits 2", () => {
        withDeck("notes-document", deck => {
            assert.equal(notes(deck, "import", path.basename(deck.json)).code, 2);
        });
    });

    test("one argument too many exits 2", () => {
        withDeck("notes-document", deck => {
            const {code, json} = notes(deck, "export", path.basename(deck.json), "a.md", "b.md");
            assert.equal(code, 2);
            assert.match(json.error, /b\.md/);
        });
    });

    test("a missing Markdown file exits 1", () => {
        withDeck("notes-document", deck => {
            const {code, json} = notes(deck, "import", path.basename(deck.json), "gone.md");
            assert.equal(code, 1);
            assert.match(json.error, /gone\.md/);
        });
    });

    test("a missing deck exits 1", () => {
        withDeck("notes-document", deck => {
            assert.equal(notes(deck, "export", "gone.sozi.json").code, 1);
        });
    });
});
