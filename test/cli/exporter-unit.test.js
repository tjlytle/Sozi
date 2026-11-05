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
 *
 * @returns {object} - The exports of the built exporter module.
 */
function loadExporter() {
    delete require.cache[require.resolve(exporterModule)];
    return require(exporterModule);
}

/** The size of the fake captures, in pixels.
 *
 * @type {{width: number, height: number}}
 */
const size = {width: 16, height: 9};

/** A fake PNG file: a header with the capture size, then the frame it shows.
 *
 * @param {number} frame - The index of the frame in the image.
 * @returns {Buffer} - The PNG header and a `frame:<index>` marker.
 */
function fakePng(frame) {
    const png = Buffer.alloc(40);
    png.write("\x89PNG\r\n\x1a\n", 0, "latin1");
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12);
    png.writeUInt32BE(size.width, 16);
    png.writeUInt32BE(size.height, 20);
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

/** A fake export window whose page shows frames and presents them to the screen.
 *
 * Like a hidden window on a loaded machine, it presents a new picture only when the
 * exporter repaints for a screenshot (`kick`), so `capturePage` returns the last
 * picture presented, which can be older than the frame the page shows.
 *
 * @param {object} [opts] - How the page behaves.
 * @param {boolean} [opts.follows] - Does `jumpToFrame` change the frame shown (default true)?
 * @param {boolean} [opts.presents] - Does a repaint present a picture (default true)?
 * @param {boolean} [opts.animating] - Does the page report a running animation (default false)?
 * @returns {object} - A stand-in for an Electron `BrowserWindow`.
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
            if (code.includes("__soziExport.state()")) {
                return Promise.resolve({index: page.index, animating});
            }
            if (code.includes("__soziExport.kick(true)") && presents) {
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
        debugger: fakeDebugger(page)
    };
    return {webContents, isDestroyed: () => false, destroy() {}};
}

/** The Chrome DevTools Protocol debugger of a fake export window.
 *
 * A screenshot waits for the next picture the page presents, as `Page.captureScreenshot` does.
 *
 * @param {{screenshots: Function[]}} page - The fake page, which resolves the waiting screenshots.
 * @returns {object} - A stand-in for `webContents.debugger`.
 */
function fakeDebugger(page) {
    return {
        attached: false,
        isAttached() {
            return this.attached;
        },
        attach() {
            this.attached = true;
        },
        sendCommand(name) {
            if (name === "Page.captureScreenshot") {
                return new Promise(resolve => page.screenshots.push(resolve));
            }
            return Promise.resolve({});
        }
    };
}

describe("ExportWindow", () => {
    test("captures the frame it jumped to, not the last picture the window presented", async () => {
        const {ExportWindow} = loadExporter();
        const ew = new ExportWindow(fakeWindow(), {...size, timeoutMs: 1000});
        await ew.jumpToFrame(4);
        assert.equal(frameOf(await ew.capture()), 4);
    });

    test("rejects a jump when the page shows another frame", async () => {
        const {ExportWindow} = loadExporter();
        const ew = new ExportWindow(fakeWindow({follows: false}), {...size, timeoutMs: 1000});
        await assert.rejects(ew.jumpToFrame(4), /the export window shows frame 0, expected 4/);
    });

    test("rejects a transition step when the page has left the frame it starts from", async () => {
        const {ExportWindow} = loadExporter();
        const ew = new ExportWindow(fakeWindow(), {...size, timeoutMs: 1000});
        await assert.rejects(ew.expectFrame(2), /the export window shows frame 0, expected 2/);
    });

    test("rejects when the page is animating", async () => {
        const {ExportWindow} = loadExporter();
        const ew = new ExportWindow(fakeWindow({animating: true}), {...size, timeoutMs: 1000});
        await assert.rejects(ew.expectFrame(0), /the export window is animating/);
    });

    test("a capture that never gets a new picture rejects with its step name in time", async () => {
        const {ExportWindow} = loadExporter();
        const ew = new ExportWindow(fakeWindow({presents: false}), {...size, timeoutMs: 50});
        await ew.jumpToFrame(4);
        const start = Date.now();
        await assert.rejects(ew.capture(), /did not respond within 0\.05 s \(screenshot\)/);
        assert.ok(Date.now() - start < 1000, "rejected within the time limit");
    });
});

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
            const to = path.join(dir, "b.png");
            fs.writeFileSync(from, "image");
            linkOrCopy(from, to);
            assert.equal(fs.readFileSync(to, "utf8"), "image");
            assert.notEqual(fs.statSync(to).ino, fs.statSync(from).ino, "a copy, not a link");
        } finally {
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
            const to = path.join(dir, "b.png");
            fs.writeFileSync(from, "image");
            linkOrCopy(from, to);
            assert.equal(fs.statSync(to).ino, fs.statSync(from).ino);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});
