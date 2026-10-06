/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Unit tests of exporter helpers, on the built module loaded in plain Node.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {appDir} = require("./helpers.js");

const exporterModule = path.join(appDir, "src", "js", "exporter", "index-electron.js");

/** Load a fresh copy of the built exporter module.
 *
 * The compiled module copies the functions of `fs` when it is loaded,
 * so stubs of `fs` must be in place before this call.
 */
function loadExporter() {
    delete require.cache[require.resolve(exporterModule)];
    return require(exporterModule);
}

describe("linkOrCopy", () => {
    test("copies the file when the file system has no hard links (ENOTSUP)", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-test-"));
        const linkSync = fs.linkSync;
        try {
            fs.linkSync = () => {
                throw Object.assign(new Error("operation not supported"), {code: "ENOTSUP"});
            };
            const {linkOrCopy} = loadExporter();
            const from = path.join(dir, "a.png");
            const to   = path.join(dir, "b.png");
            fs.writeFileSync(from, "image");
            linkOrCopy(from, to);
            assert.equal(fs.readFileSync(to, "utf8"), "image");
            assert.notEqual(fs.statSync(to).ino, fs.statSync(from).ino, "a copy, not a link");
        }
        finally {
            fs.linkSync = linkSync;
            delete require.cache[require.resolve(exporterModule)];
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    test("links the file where hard links work", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-test-"));
        try {
            const {linkOrCopy} = loadExporter();
            const from = path.join(dir, "a.png");
            const to   = path.join(dir, "b.png");
            fs.writeFileSync(from, "image");
            linkOrCopy(from, to);
            assert.equal(fs.statSync(to).ino, fs.statSync(from).ino);
        }
        finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});
