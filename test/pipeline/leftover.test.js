/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// test/pipeline/leftover.test.js: which patches a session left for the next try, and the
// prompt section that hands them over.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {leftoverNote, leftoverPatches} from "../../pipeline/lib/leftover.js";

describe("leftoverPatches", () => {
    test("leaves out carry.patch, which the usage-limit carry handles", () => {
        assert.deepEqual(leftoverPatches(["carry.patch", "75-x.patch"]), ["75-x.patch"]);
    });
    test("leaves out names that do not end in .patch", () => {
        const names = ["log", "result.json", "75-x.patch.txt", "req-done.json", "75-x.patch"];
        assert.deepEqual(leftoverPatches(names), ["75-x.patch"]);
    });
    test("sorts the names and keeps the first ten", () => {
        const names = Array.from(
            {length: 12},
            (_, i) => `p${String(11 - i).padStart(2, "0")}.patch`
        );
        const kept = leftoverPatches(names);
        assert.equal(kept.length, 10);
        assert.equal(kept[0], "p00.patch");
        assert.equal(kept[9], "p09.patch");
    });
});

describe("leftoverNote", () => {
    test("lists every path and says to apply them with git apply --3way", () => {
        const note = leftoverNote(["/outbox/carried/75-a.patch", "/outbox/carried/75-b.patch"]);
        assert.match(note, /## Work left by the last try/);
        assert.match(note, /`\/outbox\/carried\/75-a\.patch`/);
        assert.match(note, /`\/outbox\/carried\/75-b\.patch`/);
        assert.match(note, /git apply --3way/);
    });
});
