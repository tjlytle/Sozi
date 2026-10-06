/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {parseArgs, validateArgs} = require("../../src/js/cli/args.js");
const {runSozi, withTempDeck} = require("./helpers.js");

const ELECTRON = "/path/to/electron";
const APP = "/path/to/build/electron";

// The flags of each command, as exported by src/js/cli/commands/*.js.
const FLAGS = {build: {"write-json": false}, inspect: {frame: true}};

describe("parseArgs", () => {
    test("no --cli means GUI mode", () => {
        const parsed = parseArgs([ELECTRON, APP, "deck.svg"]);
        assert.equal(parsed.cli, false);
    });

    test("command and positional", () => {
        assert.deepEqual(parseArgs([ELECTRON, APP, "--cli", "build", "deck.svg"]), {
            cli: true, command: "build", positionals: ["deck.svg"], flags: {}
        });
    });

    test("packaged binary without an app path", () => {
        assert.deepEqual(parseArgs(["/opt/sozi/sozi", "--cli", "inspect", "deck.svg"]), {
            cli: true, command: "inspect", positionals: ["deck.svg"], flags: {}
        });
    });

    test("no command", () => {
        assert.deepEqual(parseArgs([ELECTRON, APP, "--cli"]), {
            cli: true, command: null, positionals: [], flags: {}
        });
    });

    test("--name=value and --name value", () => {
        const parsed = parseArgs([ELECTRON, APP, "--cli", "inspect", "--size=640x480", "--frame", "2", "deck.svg"], FLAGS);
        assert.deepEqual(parsed.flags, {size: "640x480", frame: "2"});
        assert.deepEqual(parsed.positionals, ["deck.svg"]);
    });

    test("boolean flags of the command do not take a value", () => {
        const parsed = parseArgs([ELECTRON, APP, "--cli", "build", "--write-json", "deck.svg"], FLAGS);
        assert.deepEqual(parsed.flags, {"write-json": true});
        assert.deepEqual(parsed.positionals, ["deck.svg"]);
    });

    test("unknown flags do not take a value", () => {
        const parsed = parseArgs([ELECTRON, APP, "--cli", "build", "--dry-run", "deck.svg"], FLAGS);
        assert.deepEqual(parsed.flags, {"dry-run": true});
        assert.deepEqual(parsed.positionals, ["deck.svg"]);
    });

    test("a value-taking flag with no value is true", () => {
        assert.deepEqual(parseArgs([ELECTRON, APP, "--cli", "inspect", "deck.svg", "--frame"], FLAGS).flags, {frame: true});
        assert.deepEqual(parseArgs([ELECTRON, APP, "--cli", "inspect", "--frame", "--size", "1x1", "deck.svg"], FLAGS).flags, {frame: true, size: "1x1"});
    });

    test("global flags take a value with any command", () => {
        const parsed = parseArgs([ELECTRON, APP, "--cli", "build", "--timeout", "5", "--size", "640x480", "deck.svg"], FLAGS);
        assert.deepEqual(parsed.flags, {timeout: "5", size: "640x480"});
        assert.deepEqual(parsed.positionals, ["deck.svg"]);
    });

    test("--help is boolean", () => {
        const parsed = parseArgs([ELECTRON, APP, "--cli", "--help", "build"], FLAGS);
        assert.equal(parsed.flags.help, true);
        assert.equal(parsed.command, "build");
    });

    test("Chromium switches are ignored", () => {
        const parsed = parseArgs([ELECTRON, "--no-sandbox", APP, "--enable-logging", "--cli",
                                  "build", "--disable-gpu", "deck.svg"], FLAGS);
        assert.deepEqual(parsed, {
            cli: true, command: "build", positionals: ["deck.svg"], flags: {}
        });
    });
});

describe("validateArgs", () => {
    const check = (...args) => validateArgs(parseArgs([ELECTRON, APP, "--cli", ...args], FLAGS), FLAGS);

    test("valid command lines", () => {
        assert.equal(check("build", "deck.svg"), null);
        assert.equal(check("build", "--write-json", "--size", "640x480", "--timeout=5", "deck.svg"), null);
        assert.equal(check("inspect", "--frame", "2", "deck.svg"), null);
        assert.equal(check("inspect"), null, "a missing file is reported by the runner");
    });

    test("unknown flag", () => {
        assert.equal(check("build", "--no-jsn", "deck.svg"), "unknown option for build: --no-jsn");
        assert.equal(check("build", "deck.svg", "--verbose"), "unknown option for build: --verbose");
        assert.equal(check("build", "--frame", "1", "deck.svg"), "unknown option for build: --frame");
    });

    test("missing value", () => {
        assert.equal(check("inspect", "deck.svg", "--frame"), "missing value for --frame");
        assert.equal(check("inspect", "--frame=", "deck.svg"), "missing value for --frame");
    });

    test("value given to a boolean flag", () => {
        assert.equal(check("build", "--write-json=no", "deck.svg"), "option --write-json does not take a value");
    });

    test("extra positionals", () => {
        assert.equal(check("build", "deck.svg", "other.svg"), "unexpected argument: other.svg");
    });
});

describe("electron entry", () => {
    test("--cli with no command exits 2 with usage JSON", () => {
        const {code, stdout, json} = runSozi([]);
        assert.equal(code, 2, stdout);
        assert.deepEqual(json, {ok: false, usage: "sozi --cli <inspect|build> [options] <file.svg>"});
        assert.equal(stdout.trim().split("\n").length, 1);
    });

    test("--cli --help exits 2 with usage JSON", () => {
        const {code, json} = runSozi(["build", "--help"]);
        assert.equal(code, 2);
        assert.equal(json.ok, false);
        assert.match(json.usage, /^sozi --cli/);
    });

    test("invalid --size exits 2", () => {
        const {code, json} = runSozi(["build", "--size", "big", "deck.svg"]);
        assert.equal(code, 2);
        assert.equal(json.ok, false);
        assert.match(json.error, /--size/);
    });

    test("build on a missing file exits 1 with an error JSON", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-test-"));
        try {
            const {code, stdout, stderr, json} = runSozi(["build", "missing.svg"], {cwd: dir});
            assert.equal(code, 1, `stdout: ${stdout}\nstderr: ${stderr}`);
            assert.equal(json.ok, false);
            assert.equal(json.error, `file not found: ${path.join(dir, "missing.svg")}`);
            assert.equal(stdout.trim().split("\n").length, 1);
        }
        finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });

    test("no display exits 2", {skip: process.platform !== "linux"}, () => {
        const env = {...process.env};
        delete env.DISPLAY;
        delete env.WAYLAND_DISPLAY;
        const {code, json} = runSozi(["build", "deck.svg"], {env});
        assert.equal(code, 2);
        assert.deepEqual(json, {ok: false, error: "no display; run under xvfb-run"});
    });
});

describe("withTempDeck", () => {
    test("copies a file pair or a directory fixture", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cli-fixtures-"));
        try {
            fs.writeFileSync(path.join(root, "pair.svg"), "<svg/>");
            fs.writeFileSync(path.join(root, "pair.sozi.json"), "{}");
            fs.mkdirSync(path.join(root, "folder"));
            fs.writeFileSync(path.join(root, "folder", "deck.svg"), "<svg/>");
            fs.writeFileSync(path.join(root, "folder", "deck.sozi.json"), "{}");

            for (const [name, base] of [["pair", "pair"], ["folder", "deck"]]) {
                const deck = withTempDeck(name, {fixturesDir: root});
                try {
                    assert.equal(deck.svg, path.join(deck.dir, base + ".svg"));
                    assert.equal(deck.json, path.join(deck.dir, base + ".sozi.json"));
                    assert.ok(fs.existsSync(deck.svg));
                    assert.ok(fs.existsSync(deck.json));
                }
                finally {
                    deck.cleanup();
                }
                assert.ok(!fs.existsSync(deck.dir));
            }
        }
        finally {
            fs.rmSync(root, {recursive: true, force: true});
        }
    });
});
