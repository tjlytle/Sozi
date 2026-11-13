/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    ExportWindow,
    withTimeout,
    DEFAULT_TIMEOUT_MS
} from "../../../src/js/exporter/ExportWindow.js";

/** The size the export window is asked for, in pixels.
 *
 * @type {{width: number, height: number}}
 */
const size = {width: 16, height: 9};

/** A fake PNG file: a header with the capture size, then the frame it shows.
 *
 * @param {number} frame - The index of the frame in the image.
 * @param {{width: number, height: number}} [shotSize] - The size in the header.
 * @returns {Buffer} - The PNG header and a `frame:<index>` marker.
 */
function fakePng(frame, shotSize = size) {
    const png = Buffer.alloc(40);
    png.write("\x89PNG\r\n\x1a\n", 0, "latin1");
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12);
    png.writeUInt32BE(shotSize.width, 16);
    png.writeUInt32BE(shotSize.height, 20);
    png.write(`frame:${frame}`, 24);
    return png;
}

/** The frame a fake PNG file shows.
 *
 * @param {Buffer} png - A result of `fakePng`.
 * @returns {number} - The index of the frame.
 */
function frameOf(png) {
    const match = /frame:(\d+)/.exec(png.toString("latin1"));
    return match ? Number(match[1]) : NaN;
}

/** The Chrome DevTools Protocol debugger of a fake export window.
 *
 * @param {() => Promise<{data: string}>} screenshot - The answer to `Page.captureScreenshot`.
 * @returns {object} - A stand-in for `webContents.debugger`.
 */
function fakeDebugger(screenshot) {
    return {
        attached: false,
        isAttached() {
            return this.attached;
        },
        attach() {
            this.attached = true;
        },
        sendCommand(name) {
            return name === "Page.captureScreenshot" ? screenshot() : Promise.resolve({});
        }
    };
}

/** A stand-in for a browser window whose screenshots have a fixed size.
 *
 * @param {{width: number, height: number}} shotSize - The size of every screenshot.
 * @returns {any} - The window, typed `any` so that it stands in for a `BrowserWindow`;
 *  its `destroyed` field counts the calls to `destroy`.
 */
function sizedWindow(shotSize) {
    const data = fakePng(0, shotSize).toString("base64");
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
            debugger: fakeDebugger(() => Promise.resolve({data}))
        }
    };
}

/** A fake export window whose page shows frames and presents them to the screen.
 *
 * Like a hidden window on a loaded machine, it presents a new picture only when the
 * exporter repaints for a screenshot (`kick`), so a screenshot waits for that picture,
 * as `Page.captureScreenshot` does, and `capturePage` returns the last picture
 * presented, which can be older than the frame the page shows.
 *
 * @param {object} [opts] - How the page behaves.
 * @param {boolean} [opts.follows] - Does `jumpToFrame` change the frame shown (default true)?
 * @param {boolean} [opts.presents] - Does a repaint present a picture (default true)?
 * @param {boolean} [opts.animating] - Does the page report a running animation (default false)?
 * @returns {any} - A stand-in for an Electron `BrowserWindow`.
 */
function fakeWindow({follows = true, presents = true, animating = false} = {}) {
    /** @type {{index: number, presented: number, screenshots: Function[]}} */
    const page = {index: 0, presented: 0, screenshots: []};
    const present = () => {
        page.presented = page.index;
        for (const resolve of page.screenshots.splice(0)) {
            resolve({data: fakePng(page.presented).toString("base64")});
        }
    };
    const webContents = {
        executeJavaScript(code) {
            const jump = /jumpToFrame\((\d+)\)/.exec(code);
            if (jump) {
                if (follows) {
                    page.index = Number(jump[1]);
                }
                return Promise.resolve();
            }
            if (code.includes("sozi.exportDriver.state()")) {
                return Promise.resolve({index: page.index, animating});
            }
            if (code.includes("sozi.exportDriver.kick(true)") && presents) {
                present();
            }
            return Promise.resolve(true);
        },
        capturePage() {
            const frame = page.presented;
            return Promise.resolve({
                isEmpty: () => false,
                getSize: () => size,
                toBitmap: () => Buffer.from([1, 0, 0, 0, 2, 0, 0, 0]),
                toPNG: () => fakePng(frame)
            });
        },
        debugger: fakeDebugger(() => new Promise(resolve => page.screenshots.push(resolve)))
    };
    return {webContents, isDestroyed: () => false, destroy() {}};
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
    test("captures the frame it jumped to, not the last picture the window presented", async () => {
        const ew = new ExportWindow(fakeWindow(), {...size, timeoutMs: 1000});
        await ew.jumpToFrame(4);
        assert.equal(frameOf(await ew.capture()), 4);
    });
    test("rejects a jump when the page shows another frame", async () => {
        const ew = new ExportWindow(fakeWindow({follows: false}), {...size, timeoutMs: 1000});
        await assert.rejects(ew.jumpToFrame(4), /the export window shows frame 0, expected 4/);
    });
    test("rejects a transition step when the page has left the frame it starts from", async () => {
        const ew = new ExportWindow(fakeWindow(), {...size, timeoutMs: 1000});
        await assert.rejects(ew.expectFrame(2), /the export window shows frame 0, expected 2/);
    });
    test("rejects when the page is animating", async () => {
        const ew = new ExportWindow(fakeWindow({animating: true}), {...size, timeoutMs: 1000});
        await assert.rejects(ew.expectFrame(0), /the export window is animating/);
    });
    test("a capture that never gets a new picture rejects with its step name in time", async () => {
        const ew = new ExportWindow(fakeWindow({presents: false}), {...size, timeoutMs: 50});
        await ew.jumpToFrame(4);
        const start = Date.now();
        await assert.rejects(ew.capture(), /did not respond within 0\.05 s \(screenshot\)/);
        assert.ok(Date.now() - start < 1000, "rejected within the time limit");
    });
});
