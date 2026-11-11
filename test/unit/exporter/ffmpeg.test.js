/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {defaultFfmpegTimeoutMs, findFfmpeg} from "../../../src/js/exporter/ffmpeg.js";

describe("defaultFfmpegTimeoutMs", () => {
    test("is ten minutes for no image", () => {
        assert.equal(defaultFfmpegTimeoutMs(0), 10 * 60 * 1000);
    });
    test("grows by 100 ms per image", () => {
        assert.equal(defaultFfmpegTimeoutMs(1000) - defaultFfmpegTimeoutMs(0), 100 * 1000);
    });
});

describe("findFfmpeg", () => {
    test("an explicit path that does not exist finds nothing", () => {
        assert.equal(findFfmpeg(path.join(os.tmpdir(), "sozi-no-such-ffmpeg")), null);
    });
    test("an explicit path that is not executable finds nothing", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-ffmpeg-test-"));
        try {
            const file = path.join(dir, "ffmpeg");
            fs.writeFileSync(file, "", {mode: 0o644});
            assert.equal(findFfmpeg(file), null);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
    test("an explicit executable path is found, resolved", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-ffmpeg-test-"));
        try {
            const file = path.join(dir, "ffmpeg");
            fs.writeFileSync(file, "", {mode: 0o755});
            assert.equal(findFfmpeg(path.relative(process.cwd(), file)), file);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});
