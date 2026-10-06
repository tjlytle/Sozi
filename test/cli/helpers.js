/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Helpers for the CLI tests.
//
// The tests spawn the real Electron binary on build/electron, so they assume
// a current build: run `npx gulp` after editing src/ and before `npm test`.

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
 * @param {object} [opts] - `cwd` (default: the repository), `env` (default: process.env).
 * @returns {{code: number|null, stdout: string, stderr: string, json: object|null}}
 */
function runSozi(args, {cwd = repoDir, env = process.env} = {}) {
    const result = spawnSync(electronBinary, [appDir, "--cli", ...args], {
        cwd,
        env,
        encoding: "utf8",
        timeout: 60000,
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

module.exports = {runSozi, withTempDeck, repoDir, appDir, fixturesDir};
