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

module.exports = {runSozi, withTempDeck, decodePng, electronBinary, repoDir, appDir, fixturesDir};
