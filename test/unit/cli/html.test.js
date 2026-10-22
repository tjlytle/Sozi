import {test, describe, before, after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {builtModule} from "../support/stubs.js";

const {isStale, presentationHtml} = await builtModule("cli/html.js");

let dir = "";
before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-unit-html-"));
});
after(() => {
    fs.rmSync(dir, {recursive: true, force: true});
});

/** Create a file with a given modification time.
 *
 * @param {string} name - The file name inside the scratch directory.
 * @param {number} seconds - The modification time, in seconds since the epoch.
 * @returns {string} - The path of the file.
 */
function fileAt(name, seconds) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, "x");
    fs.utimesSync(file, seconds, seconds);
    return file;
}

describe("isStale", () => {
    test("a missing HTML file is stale", () => {
        assert.equal(isStale(path.join(dir, "missing.html"), []), true);
    });

    test("an HTML file newer than its sources is fresh", () => {
        const html = fileAt("new.html", 2000);
        assert.equal(isStale(html, [fileAt("old.svg", 1000), fileAt("old.json", 1500)]), false);
    });

    test("an HTML file older than one source is stale", () => {
        const html = fileAt("older.html", 1000);
        assert.equal(isStale(html, [fileAt("a.svg", 500), fileAt("b.json", 2000)]), true);
    });

    test("a source with the same time as the HTML file does not make it stale", () => {
        const html = fileAt("same.html", 1000);
        assert.equal(isStale(html, [fileAt("same.svg", 1000)]), false);
    });

    test("missing sources are ignored", () => {
        const html = fileAt("alone.html", 1000);
        assert.equal(isStale(html, [path.join(dir, "no.svg"), path.join(dir, "no.json")]), false);
    });
});

describe("presentationHtml", () => {
    const context = flags => ({
        storage: {presentation: {outputDir: ""}},
        svg: path.join(dir, "deck.svg"),
        presentation: path.join(dir, "deck.sozi.json"),
        cwd: dir,
        flags
    });

    test("returns the HTML path next to the SVG file by default", () => {
        assert.deepEqual(presentationHtml(context({})), {
            html: path.join(dir, "deck.sozi.html"),
            error: null
        });
    });

    test("--out-dir moves the HTML file into that directory", () => {
        assert.deepEqual(presentationHtml(context({"out-dir": "site"})), {
            html: path.join(dir, "site", "deck.sozi.html"),
            error: null
        });
    });

    test("returns the usage error when the output directory is a file", () => {
        fs.writeFileSync(path.join(dir, "blocker"), "x");
        const result = presentationHtml(context({"out-dir": "blocker"}));
        assert.equal(result.html, null);
        assert.match(result.error ?? "", /is not a directory$/);
    });
});
