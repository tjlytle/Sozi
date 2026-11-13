/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test, describe, beforeEach, afterEach, mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import os from "node:os";
import path from "node:path";
import {partialPath, moveFile, writeOutput, linkOrCopy} from "../../../src/js/exporter/files.js";

/** A fresh temporary directory for each test. */
let dir = "";

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-files-test-"));
});

afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true});
});

describe("partialPath", () => {
    test("is a hidden file next to the output, with the same extension", () => {
        assert.equal(
            partialPath(path.join("out", "talk.webm")),
            path.join("out", ".talk.partial.webm")
        );
    });
});

describe("moveFile", () => {
    test("moves a file, replacing the target", () => {
        const from = path.join(dir, "a.txt");
        const to = path.join(dir, "b.txt");
        fs.writeFileSync(from, "new");
        fs.writeFileSync(to, "old");
        moveFile(from, to);
        assert.equal(fs.readFileSync(to, "utf8"), "new");
        assert.equal(fs.existsSync(from), false);
    });
});

describe("writeOutput", () => {
    test("writes through the partial file and creates the directories", async () => {
        const out = path.join(dir, "sub", "deck.pdf");
        let written = "";
        await writeOutput(out, partial => {
            written = partial;
            fs.writeFileSync(partial, "pdf");
        });
        assert.equal(written, partialPath(out));
        assert.equal(fs.readFileSync(out, "utf8"), "pdf");
        assert.equal(fs.existsSync(written), false);
    });
    test("a failed write leaves no partial file and keeps the previous output", async () => {
        const out = path.join(dir, "deck.pdf");
        fs.writeFileSync(out, "previous");
        await assert.rejects(
            writeOutput(out, partial => {
                fs.writeFileSync(partial, "half");
                throw new Error("disk full");
            }),
            /disk full/
        );
        assert.equal(fs.readFileSync(out, "utf8"), "previous");
        assert.deepEqual(fs.readdirSync(dir), ["deck.pdf"]);
    });
    test("a failed write removes the directories it created", async () => {
        const out = path.join(dir, "a", "b", "deck.pdf");
        await assert.rejects(
            writeOutput(out, () => {
                throw new Error("failed");
            })
        );
        assert.deepEqual(fs.readdirSync(dir), []);
    });
});

describe("linkOrCopy", () => {
    test("copies the file when the file system has no hard links (ENOTSUP)", () => {
        // files.js reads the named exports of "fs", which follow the CommonJS object
        // only after syncBuiltinESMExports().
        const linkSync = mock.method(fs, "linkSync", () => {
            throw Object.assign(new Error("operation not supported"), {code: "ENOTSUP"});
        });
        syncBuiltinESMExports();
        try {
            const from = path.join(dir, "a.png");
            const to = path.join(dir, "b.png");
            fs.writeFileSync(from, "image");
            linkOrCopy(from, to);
            assert.equal(linkSync.mock.callCount(), 1);
            assert.equal(fs.readFileSync(to, "utf8"), "image");
            assert.notEqual(fs.statSync(to).ino, fs.statSync(from).ino, "a copy, not a link");
        } finally {
            linkSync.mock.restore();
            syncBuiltinESMExports();
        }
    });
    test("links the file where hard links work", () => {
        const from = path.join(dir, "a.png");
        const to = path.join(dir, "b.png");
        fs.writeFileSync(from, "image");
        linkOrCopy(from, to);
        assert.equal(fs.statSync(to).ino, fs.statSync(from).ino);
    });
});
