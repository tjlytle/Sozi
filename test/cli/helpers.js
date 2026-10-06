/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Helpers for the CLI tests.
//
// The tests spawn the real Electron binary on build/electron, so they assume
// a current build: run `npx gulp` after editing src/ and before `npm test`.

const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoDir     = path.resolve(__dirname, "..", "..");
const appDir      = path.join(repoDir, "build", "electron");
const fixturesDir = path.join(repoDir, "test", "fixtures");

// The electron npm package exports the path of its binary.
const electronBinary = require("electron");

/** Run `electron build/electron --cli ...args`.
 *
 * @param {string[]} args - The CLI arguments after `--cli`.
 * @param {object} [opts] - `cwd` (default: the repository), `env` (default: process.env),
 *  `timeout` in milliseconds (default: 60000).
 * @returns {{code: number|null, stdout: string, stderr: string, json: object|null}}
 */
function runSozi(args, {cwd = repoDir, env = process.env, timeout = 60000} = {}) {
    const result = spawnSync(electronBinary, [appDir, "--cli", ...args], {
        cwd,
        env,
        encoding: "utf8",
        timeout,
        // Electron ignores SIGTERM while a window is open.
        killSignal: "SIGKILL"
    });
    if (result.error) {
        throw result.error;
    }
    let json = null;
    try {
        json = JSON.parse(result.stdout);
    }
    catch {
        // Leave json null; tests assert on it.
    }
    return {code: result.status, stdout: result.stdout, stderr: result.stderr, json};
}

/** Copy a fixture deck into a fresh temporary directory.
 *
 * A fixture is either a pair `<fixturesDir>/<name>.svg` + `<name>.sozi.json`,
 * or a directory `<fixturesDir>/<name>/` whose files are all copied
 * (it must contain exactly one `.svg`).
 *
 * @param {string} fixtureName - The fixture name.
 * @param {object} [opts] - `fixturesDir` (default: test/fixtures).
 * @returns {{dir: string, svg: string, json: string, cleanup: Function}}
 */
function withTempDeck(fixtureName, {fixturesDir: root = fixturesDir} = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-test-"));
    const fixtureDir = path.join(root, fixtureName);
    let svgName;
    if (fs.existsSync(fixtureDir) && fs.statSync(fixtureDir).isDirectory()) {
        fs.cpSync(fixtureDir, dir, {recursive: true});
        const svgs = fs.readdirSync(dir).filter(name => name.endsWith(".svg"));
        if (svgs.length !== 1) {
            throw new Error(`fixture ${fixtureName} must contain exactly one .svg, found ${svgs.length}`);
        }
        svgName = svgs[0];
    }
    else {
        svgName = fixtureName + ".svg";
        fs.copyFileSync(path.join(root, svgName), path.join(dir, svgName));
        fs.copyFileSync(path.join(root, fixtureName + ".sozi.json"), path.join(dir, fixtureName + ".sozi.json"));
    }
    const svg = path.join(dir, svgName);
    return {
        dir,
        svg,
        json: svg.replace(/\.svg$/, ".sozi.json"),
        cleanup: () => fs.rmSync(dir, {recursive: true, force: true})
    };
}

/** Decode an 8-bit, non-interlaced RGB or RGBA PNG (what Chrome writes).
 *
 * @returns {{width: number, height: number, pixel: Function}} - `pixel(x, y)` gives `[r, g, b]`.
 */
function decodePng(buf) {
    const zlib = require("node:zlib");
    assert.ok(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "PNG signature");
    let width, height, channels;
    const idat = [];
    for (let o = 8; o < buf.length; ) {
        const length = buf.readUInt32BE(o);
        const type = buf.toString("ascii", o + 4, o + 8);
        const data = buf.subarray(o + 8, o + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            assert.equal(data[8], 8, "PNG bit depth");
            assert.equal(data[12], 0, "PNG interlace");
            channels = {2: 3, 6: 4}[data[9]];
            assert.ok(channels, `PNG color type ${data[9]}`);
        }
        else if (type === "IDAT") {
            idat.push(data);
        }
        o += 12 + length;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        for (let i = 0; i < stride; i++) {
            const x = raw[y * (stride + 1) + 1 + i];
            const a = i >= channels ? pixels[y * stride + i - channels] : 0;
            const b = y > 0 ? pixels[(y - 1) * stride + i] : 0;
            const c = i >= channels && y > 0 ? pixels[(y - 1) * stride + i - channels] : 0;
            const p = a + b - c;
            const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a :
                Math.abs(p - b) <= Math.abs(p - c) ? b : c;
            pixels[y * stride + i] = (x + [0, a, b, (a + b) >> 1, paeth][filter]) & 0xff;
        }
    }
    return {width, height, pixel: (x, y) => [...pixels.subarray(y * stride + x * channels, y * stride + x * channels + 3)]};
}

/** Write a fake ffmpeg that records its process id and never finishes.
 *
 * @param {string} dir - The directory of the script.
 * @returns {{path: string, pid: Function}} - The script; `pid()` reads its process id, or null if it never ran.
 */
function fakeFfmpeg(dir) {
    const file = path.join(dir, "stuck-ffmpeg");
    const pidFile = path.join(dir, "stuck-ffmpeg.pid");
    fs.writeFileSync(file, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 60\n`, {mode: 0o755});
    return {path: file, pid: () => fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, "utf8")) : null};
}

/** Is a process running? A zombie counts as finished.
 *
 * @param {?number} pid - A process id.
 * @returns {boolean} - true if the process exists and is not a zombie.
 */
function isAlive(pid) {
    if (!pid) {
        return false;
    }
    try {
        process.kill(pid, 0);
    }
    catch {
        return false;
    }
    try {
        return !/^\S+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
    }
    catch {
        return true;
    }
}

/** Find an executable on the PATH.
 *
 * @param {string} name - The executable name.
 * @returns {?string} - Its path, or null.
 */
function which(name) {
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
        const file = path.join(dir, name);
        try {
            fs.accessSync(file, fs.constants.X_OK);
            return file;
        }
        catch {
            // Not in this directory.
        }
    }
    return null;
}

/** The entries of a zip file, from its central directory.
 *
 * @param {Buffer} buf - The content of a zip file.
 * @returns {{name: string, data: Function}[]} - The entries; `data()` gives the uncompressed content.
 */
function zipEntries(buf) {
    const zlib = require("node:zlib");
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(eocd >= 0, "zip end of central directory");
    const count = buf.readUInt16LE(eocd + 10);
    let o = buf.readUInt32LE(eocd + 16);
    const entries = [];
    for (let i = 0; i < count; i++) {
        assert.equal(buf.readUInt32LE(o), 0x02014b50, "zip central directory entry");
        const method         = buf.readUInt16LE(o + 10);
        const compressedSize = buf.readUInt32LE(o + 20);
        const nameLength     = buf.readUInt16LE(o + 28);
        const extraLength    = buf.readUInt16LE(o + 30);
        const commentLength  = buf.readUInt16LE(o + 32);
        const local          = buf.readUInt32LE(o + 42);
        entries.push({
            name: buf.toString("utf8", o + 46, o + 46 + nameLength),
            data() {
                const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
                const raw = buf.subarray(start, start + compressedSize);
                return method === 8 ? zlib.inflateRawSync(raw) : raw;
            }
        });
        o += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

module.exports = {runSozi, withTempDeck, decodePng, zipEntries, fakeFfmpeg, isAlive, which, electronBinary, repoDir, appDir, fixturesDir};
