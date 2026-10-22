import {test, describe, before, after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {builtModule} from "../support/stubs.js";

const {outputDirError, resolveOutputDir} = await builtModule("cli/output.js");

let dir = "";
before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-unit-output-"));
    fs.writeFileSync(path.join(dir, "a-file"), "x");
    fs.mkdirSync(path.join(dir, "sub"));
});
after(() => {
    fs.rmSync(dir, {recursive: true, force: true});
});

/** Make a command context.
 *
 * @param {object} flags - The command-line flags.
 * @param {string} [outputDir] - The `outputDir` key of the presentation.
 * @returns {any} - A context for `resolveOutputDir`.
 */
function context(flags, outputDir = "") {
    return {
        storage: {presentation: {outputDir}},
        svg: path.join(dir, "deck.svg"),
        presentation: path.join(dir, "deck.sozi.json"),
        cwd: dir,
        flags
    };
}

describe("outputDirError", () => {
    test("is null for an existing directory", () => {
        assert.equal(outputDirError(dir), null);
    });

    test("is null for a directory that does not exist yet", () => {
        assert.equal(outputDirError(path.join(dir, "sub", "new", "deeper")), null);
    });

    test("returns the path that is a file, for the file itself or a descendant", () => {
        const file = path.join(dir, "a-file");
        assert.equal(outputDirError(file), file);
        assert.equal(outputDirError(path.join(file, "below")), file);
    });
});

describe("resolveOutputDir", () => {
    test("defaults to the directory of the presentation file", () => {
        assert.deepEqual(resolveOutputDir(context({})), {dir, source: "default", error: null});
    });

    test("--out-dir is relative to the working directory", () => {
        assert.deepEqual(resolveOutputDir(context({"out-dir": "sub"})), {
            dir: path.join(dir, "sub"),
            source: "flag",
            error: null
        });
    });

    test("the outputDir key is relative to the presentation file", () => {
        assert.deepEqual(resolveOutputDir(context({}, "sub")), {
            dir: path.join(dir, "sub"),
            source: "json",
            error: null
        });
    });

    test("the flag wins over the key", () => {
        const result = resolveOutputDir(context({"out-dir": "flagged"}, "sub"));
        assert.equal(result.source, "flag");
        assert.equal(result.dir, path.join(dir, "flagged"));
    });

    test("a file in the way gives an error that names the flag and the path", () => {
        const result = resolveOutputDir(context({"out-dir": "a-file"}));
        assert.equal(
            result.error,
            `--out-dir a-file: ${path.join(dir, "a-file")} is not a directory`
        );
    });

    test("a bad key names the key and the presentation file", () => {
        const result = resolveOutputDir(context({}, "a-file"));
        assert.equal(
            result.error,
            `outputDir a-file of ${path.join(dir, "deck.sozi.json")}: ${path.join(dir, "a-file")} is not a directory`
        );
    });
});
