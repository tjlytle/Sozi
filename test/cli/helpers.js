/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Helpers for the CLI tests.
//
// The tests spawn the real Electron binary on build/electron, so they assume
// a current build: run `npx gulp` after editing src/ and before `npm test`.

const {spawn} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {spawnKeepingOutput} = require("./spawn.ts");

const repoDir = path.resolve(__dirname, "..", "..");
const appDir = path.join(repoDir, "build", "electron");
const fixturesDir = path.join(repoDir, "test", "fixtures");

// The electron npm package exports the path of its binary. Cast: its types describe
// the API inside Electron instead.
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (require("electron")));

/** The Chromium switches that every Electron a test starts gets, before the test's own.
 *
 * `--disable-dev-shm-usage` puts Chromium's shared memory in /tmp instead of /dev/shm,
 * so the tests pass in a container whose /dev/shm is Docker's 64 MB default, where the
 * GPU process fails to start and the renderer hangs or crashes (#164, #191). Sozi itself
 * starts without it: a user's machine has a normal /dev/shm.
 *
 * @type {string[]}
 */
const ELECTRON_TEST_SWITCHES = ["--disable-dev-shm-usage"];

// The longest delay a Node timer accepts; spawn turns a longer timeout into 1 ms.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** A fixture deck copied into a temporary directory, as `withTempDeck` returns it.
 *
 * @typedef {{dir: string, svg: string, json: string, cleanup: Function}} Deck
 */

/** The result of a CLI run, as `runSozi` returns it: the exit code, the output streams,
 * and stdout parsed as JSON (null when it is not JSON).
 *
 * @typedef {{code: number|null, stdout: string, stderr: string, json: object|null}} SoziRun
 */

/** A time limit for a spawned browser, stretched by `SOZI_TEST_TIMEOUT_SCALE`.
 *
 * On a loaded CI runner Electron or Chrome can take over a minute to start (#232), so
 * `test/cli/run.sh` sets the scale there; a developer machine runs with the plain limit.
 *
 * @param {number} ms - The limit on an unloaded machine, in milliseconds.
 * @param {Record<string, string|undefined>} [env] - The environment (default: process.env).
 * @returns {number} - The limit times the scale, or the limit when the scale is not a
 *  finite positive number or the result would overflow a Node timer.
 */
function limit(ms, env = process.env) {
    const scale = Number(env.SOZI_TEST_TIMEOUT_SCALE);
    const scaled = Math.round(ms * scale);
    return Number.isFinite(scale) && scale > 0 && scaled <= MAX_TIMEOUT_MS ? scaled : ms;
}

/** The commands that drive an export window, whose steps report their own time-outs.
 *
 * @type {string[]}
 */
const captureCommands = ["render", "export"];

/** The CLI arguments with a `--timeout` that ends the command before the test kills it.
 *
 * The command's default limit (120 s) outlives the test's, so a hung step would end as
 * `ETIMEDOUT` without the exporter's message, which names the step.
 *
 * @param {string[]} args - The CLI arguments after `--cli`.
 * @param {number} timeoutMs - The test's time limit for the run, in milliseconds.
 * @returns {string[]} - The arguments, with `--timeout` 10 s below the test's limit for a
 *  capture command that has none.
 */
function withCommandTimeout(args, timeoutMs) {
    if (!captureCommands.includes(args[0]) || args.includes("--timeout")) {
        return args;
    }
    const seconds = Math.max(Math.floor(timeoutMs / 1000) - 10, 1);
    return [args[0], "--timeout", String(seconds), ...args.slice(1)];
}

/** Run `electron build/electron --cli ...args`, with the test Chromium switches before `--cli`.
 *
 * @param {string[]} args - The CLI arguments after `--cli`.
 * @param {object} [opts] - Options for the run.
 * @param {string} [opts.cwd] - The working directory (default: the repository).
 * @param {object} [opts.env] - The environment variables (default: process.env).
 * @param {number} [opts.timeout] - The time limit in milliseconds (default: 60000), stretched
 *  by `limit`; `render` and `export` get a `--timeout` below it, unless they have one.
 * @param {string[]} [opts.switches] - Chromium switches placed before `--cli`, after
 *  `ELECTRON_TEST_SWITCHES` (default: none).
 * @returns {SoziRun} - The exit code, the output streams, and stdout parsed as JSON.
 * @throws {Error} - When Electron cannot start, or when it reaches the time limit: then with
 *  code `ETIMEDOUT` and the output it printed so far in the message.
 */
function runSozi(args, {cwd = repoDir, env = process.env, timeout = 60000, switches = []} = {}) {
    const ms = limit(timeout);
    const cliArgs = withCommandTimeout(args, ms);
    const electronArgs = [appDir, ...ELECTRON_TEST_SWITCHES, ...switches, "--cli", ...cliArgs];
    const result = spawnKeepingOutput(electronBinary, electronArgs, {
        cwd,
        env,
        encoding: "utf8",
        timeout: ms,
        // Electron ignores SIGTERM while a window is open.
        killSignal: "SIGKILL"
    });
    if (result.error) {
        throw result.error;
    }
    return soziRun(result.status, result.stdout, result.stderr);
}

/** Start `electron build/electron --cli ...args`, with the test Chromium switches before
 * `--cli`, without waiting for it, so that a test can act while it runs.
 *
 * @param {string[]} args - The CLI arguments after `--cli`.
 * @param {object} [opts] - Options for the run.
 * @param {string} [opts.cwd] - The working directory (default: the repository).
 * @param {object} [opts.env] - The environment variables (default: process.env).
 * @param {number} [opts.timeout] - The time limit in milliseconds (default: 60000), stretched
 *  by `limit`.
 * @returns {{child: import("node:child_process").ChildProcess, done: Promise<SoziRun>}} - The
 *  running process, and its result once it exits.
 */
function runSoziAsync(args, {cwd = repoDir, env = process.env, timeout = 60000} = {}) {
    const child = spawn(electronBinary, [appDir, ...ELECTRON_TEST_SWITCHES, "--cli", ...args], {
        cwd,
        env,
        timeout: limit(timeout),
        killSignal: "SIGKILL"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", chunk => (stderr += chunk));
    const done = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", code => resolve(soziRun(code, stdout, stderr)));
    });
    return {child, done};
}

/** Put together the result of a CLI run.
 *
 * @param {number|null} code - The exit code.
 * @param {string} stdout - The standard output.
 * @param {string} stderr - The standard error.
 * @returns {SoziRun} - The exit code, the output streams, and stdout parsed as JSON.
 */
function soziRun(code, stdout, stderr) {
    let json = null;
    try {
        json = JSON.parse(stdout);
    } catch {
        // Leave json null; tests assert on it.
    }
    return {code, stdout, stderr, json};
}

/** Copy a fixture deck into a fresh temporary directory.
 *
 * A fixture is either a pair `<fixturesDir>/<name>.svg` + `<name>.sozi.json`,
 * or a directory `<fixturesDir>/<name>/` whose files are all copied
 * (it must contain exactly one `.svg`).
 *
 * @param {string} fixtureName - The fixture name.
 * @param {object} [opts] - Options.
 * @param {string} [opts.fixturesDir] - The directory of the fixtures (default: test/fixtures).
 * @returns {Deck} - The temporary directory, the paths of the SVG and JSON files in it,
 *  and a function that removes it.
 */
function withTempDeck(fixtureName, {fixturesDir: root = fixturesDir} = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-test-"));
    const fixtureDir = path.join(root, fixtureName);
    let svgName;
    if (fs.existsSync(fixtureDir) && fs.statSync(fixtureDir).isDirectory()) {
        fs.cpSync(fixtureDir, dir, {recursive: true});
        const svgs = fs.readdirSync(dir).filter(name => name.endsWith(".svg"));
        if (svgs.length !== 1) {
            throw new Error(
                `fixture ${fixtureName} must contain exactly one .svg, found ${svgs.length}`
            );
        }
        svgName = svgs[0];
    } else {
        svgName = fixtureName + ".svg";
        fs.copyFileSync(path.join(root, svgName), path.join(dir, svgName));
        fs.copyFileSync(
            path.join(root, fixtureName + ".sozi.json"),
            path.join(dir, fixtureName + ".sozi.json")
        );
    }
    const svg = path.join(dir, svgName);
    return {
        dir,
        svg,
        json: svg.replace(/\.svg$/, ".sozi.json"),
        cleanup: () => fs.rmSync(dir, {recursive: true, force: true})
    };
}

/** Make a private temporary directory for a run, to pass as TMPDIR.
 *
 * @param {string} dir - The directory of a temp deck.
 * @returns {{env: object, leftovers: Function}} - The environment of the run, and
 *  `leftovers()`, the entries that the exporter and render left in the directory.
 */
function privateTmp(dir) {
    const tmp = path.join(dir, "tmpdir");
    fs.mkdirSync(tmp);
    return {
        env: Object.assign({}, process.env, {TMPDIR: tmp}),
        // tmp-* from the exporter (the tmp package), sozi-render-* from render --all.
        leftovers: () => fs.readdirSync(tmp).filter(name => /^(tmp-|sozi-render-)/.test(name))
    };
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
    return {
        path: file,
        pid: () => (fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, "utf8")) : null)
    };
}

/** Write a fake ffmpeg that writes junk to its output file (its last argument) and fails.
 *
 * @param {string} dir - The directory of the script.
 * @returns {string} - The path of the script.
 */
function failingFfmpeg(dir) {
    const file = path.join(dir, "failing-ffmpeg");
    fs.writeFileSync(
        file,
        `#!/bin/sh\nfor last; do :; done\necho junk > "$last"\necho "simulated failure" >&2\nexit 1\n`,
        {mode: 0o755}
    );
    return file;
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
    } catch {
        return false;
    }
    try {
        return !/^\S+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
    } catch {
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
        } catch {
            // Not in this directory.
        }
    }
    return null;
}

module.exports = {
    ELECTRON_TEST_SWITCHES,
    limit,
    withCommandTimeout,
    runSozi,
    runSoziAsync,
    withTempDeck,
    privateTmp,
    fakeFfmpeg,
    failingFfmpeg,
    isAlive,
    which,
    electronBinary,
    repoDir,
    appDir,
    fixturesDir
};
