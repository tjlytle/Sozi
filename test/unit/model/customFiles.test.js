import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    CustomFileTargets,
    customFilesFor,
    readCustomFile,
    storableCustomFile
} from "../../../src/js/model/customFiles.js";

describe("customFiles", () => {
    test("a plain string is a file for the display", () => {
        assert.deepEqual(readCustomFile("a.js"), {path: "a.js", target: "display"});
    });

    test("an object keeps its target, and without one is for the display", () => {
        assert.deepEqual(readCustomFile({path: "a.js", target: "both"}), {
            path: "a.js",
            target: CustomFileTargets.both
        });
        assert.deepEqual(readCustomFile({path: "a.js"}), {path: "a.js", target: "display"});
    });

    test("a bad entry is refused, naming the field", () => {
        assert.throws(() => readCustomFile({path: "a.js", target: "phone"}), {
            name: "TypeError",
            message: /target/
        });
        assert.throws(() => readCustomFile({target: "both"}), {
            name: "TypeError",
            message: /path/
        });
        assert.throws(() => readCustomFile(""), {name: "TypeError", message: /path/});
        assert.throws(() => readCustomFile(null), {name: "TypeError", message: /path/});
    });

    test("a display file is stored as the plain string it was", () => {
        assert.equal(storableCustomFile({path: "a.js", target: "display"}), "a.js");
    });

    test("any other file round-trips as an object", () => {
        const stored = {path: "a.js", target: "presenter"};
        assert.deepEqual(storableCustomFile(readCustomFile(stored)), stored);
        assert.equal(storableCustomFile(readCustomFile("b.css")), "b.css");
    });

    test("customFilesFor picks the paths for a page and an extension", () => {
        const files = [
            {path: "d.js", target: "display"},
            {path: "p.js", target: "presenter"},
            {path: "b.js", target: "both"},
            {path: "b.css", target: "both"}
        ];
        assert.deepEqual(customFilesFor(files, "display", ".js"), ["d.js", "b.js"]);
        assert.deepEqual(customFilesFor(files, "presenter", ".js"), ["p.js", "b.js"]);
        assert.deepEqual(customFilesFor(files, "presenter", ".css"), ["b.css"]);
    });
});
