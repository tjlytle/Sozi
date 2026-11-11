/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The frame checks and the screenshot wait are tested on the built module, with a page
// that presents pictures late, in test/cli/exporter-unit.test.js. These tests cover the rest.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    ExportWindow,
    withTimeout,
    DEFAULT_TIMEOUT_MS
} from "../../../src/js/exporter/ExportWindow.js";

/** A PNG header of a given size.
 *
 * @param {number} width - The width of the image.
 * @param {number} height - The height of the image.
 * @returns {Buffer} - The first bytes of a PNG file, up to its dimensions.
 */
function pngHeader(width, height) {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(width, 16);
    png.writeUInt32BE(height, 20);
    return png;
}

/** A stand-in for a browser window whose screenshots have a fixed size.
 *
 * @param {{width: number, height: number}} shotSize - The size of every screenshot.
 * @returns {any} - The window, typed `any` so that it stands in for a `BrowserWindow`;
 *  its `destroyed` field counts the calls to `destroy`.
 */
function sizedWindow(shotSize) {
    const data = pngHeader(shotSize.width, shotSize.height).toString("base64");
    return {
        destroyed: 0,
        isDestroyed() {
            return this.destroyed > 0;
        },
        destroy() {
            this.destroyed++;
        },
        webContents: {
            executeJavaScript: () => Promise.resolve(true),
            debugger: {
                attached: false,
                isAttached() {
                    return this.attached;
                },
                attach() {
                    this.attached = true;
                },
                sendCommand: name =>
                    Promise.resolve(name === "Page.captureScreenshot" ? {data} : {})
            }
        }
    };
}

describe("withTimeout", () => {
    test("resolves with the value of the promise in time", async () => {
        assert.equal(await withTimeout(Promise.resolve(7), 1000, "late"), 7);
    });
    test("rejects with the error of the promise in time", async () => {
        await assert.rejects(
            withTimeout(Promise.reject(new Error("failed")), 1000, "late"),
            /failed/
        );
    });
    test("rejects with the message once the time limit is reached", async () => {
        await assert.rejects(withTimeout(new Promise(() => {}), 10, "too late"), /too late/);
    });
});

describe("ExportWindow", () => {
    const size = {width: 16, height: 9};

    test("uses the default time limit when none is given", () => {
        assert.equal(new ExportWindow(sizedWindow(size), size).timeoutMs, DEFAULT_TIMEOUT_MS);
        assert.equal(
            new ExportWindow(sizedWindow(size), {...size, timeoutMs: 0}).timeoutMs,
            DEFAULT_TIMEOUT_MS
        );
    });
    test("reports no capture method before the first capture, then cdp", async () => {
        const ew = new ExportWindow(sizedWindow(size), size);
        assert.equal(ew.captureMethod, null);
        await ew.capture();
        assert.equal(ew.captureMethod, "cdp");
    });
    test("rejects a capture that is not the requested size", async () => {
        const ew = new ExportWindow(sizedWindow({width: 32, height: 18}), size);
        await assert.rejects(ew.capture(), /captured image is 32x18, expected 16x9/);
    });
    test("destroys the window once, even when closed twice", () => {
        const w = sizedWindow(size);
        const ew = new ExportWindow(w, size);
        ew.close();
        ew.close();
        assert.equal(w.destroyed, 1);
    });
});
