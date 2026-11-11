// test/pipeline/command-line.test.js: reading bin/pipeline.js's command line.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {USAGE, parseCommand, parseUntil} from "../../pipeline/lib/command-line.js";

describe("parseUntil", () => {
    const now = new Date(2026, 9, 21, 19, 0, 0);
    test("a duration counts from now", () => {
        assert.equal(parseUntil("6h", now).getTime(), now.getTime() + 6 * 3600 * 1000);
        assert.equal(parseUntil("90m", now).getTime(), now.getTime() + 90 * 60 * 1000);
    });
    test("a time of day is the next one", () => {
        assert.equal(parseUntil("07:00", now).getTime(), new Date(2026, 9, 22, 7, 0).getTime());
        assert.equal(parseUntil("20:30", now).getTime(), new Date(2026, 9, 21, 20, 30).getTime());
        assert.throws(() => parseUntil("soon", now), /--until/);
    });
});

describe("parseCommand", () => {
    test("no argument watches; a number runs that issue", () => {
        assert.equal(parseCommand([]).target, "watch");
        assert.equal(parseCommand(["473", "--until", "6h"]).target, "473");
        assert.equal(parseCommand(["473", "--until", "6h"]).opt.until, "6h");
    });

    test("--copy-profile takes two personas", () => {
        assert.deepEqual(parseCommand(["--copy-profile", "builder", "qa"]).opt.copy, [
            "builder",
            "qa"
        ]);
        assert.throws(() => parseCommand(["--copy-profile", "builder"]), /takes <from> <to>/);
        assert.throws(() => parseCommand(["--copy-profile", "builder", "root"]), /persona/);
    });

    test("--login checks the persona and the harness", () => {
        assert.equal(parseCommand(["--login", "qa", "--harness", "codex"]).opt.login, "qa");
        assert.throws(() => parseCommand(["--login", "root"]), /persona must be one of/);
        assert.throws(() => parseCommand(["--login", "qa", "--harness", "x"]), /harness must/);
    });

    test("refuses a second positional, a word, and an --epic that is not a number", () => {
        assert.throws(() => parseCommand(["1", "2"]), /unexpected 1 2/);
        assert.throws(() => parseCommand(["soon"]), /unexpected soon/);
        assert.throws(() => parseCommand(["--epic", "x"]), /--epic takes an issue number/);
        assert.throws(() => parseCommand(["--nope"]));
    });

    test("the usage names every command", () => {
        const text = USAGE.join("\n");
        for (const word of ["--once", "--status", "--digest", "--login", "--copy-profile"]) {
            assert.ok(text.includes(word), word);
        }
    });
});
