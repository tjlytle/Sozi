/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests of .gitignore: the bytecode Python leaves behind when a test loads a repo
// script as a module stays out of git status, and the script itself stays tracked.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";

/** Whether git ignores a path; git reads the rules without the path existing.
 *
 * @param {string} p - The path, relative to the repository root.
 * @returns {boolean} - True when a .gitignore rule matches it.
 */
function ignored(p) {
    const result = spawnSync("git", ["check-ignore", "-q", "--no-index", p]);
    assert.ok(result.status === 0 || result.status === 1, result.stderr?.toString());
    return result.status === 0;
}

describe(".gitignore", () => {
    test("ignores the hook's __pycache__", () => {
        assert.ok(ignored(".claude/hooks/__pycache__/check-file.cpython-312.pyc"));
    });

    test("ignores __pycache__ at any depth", () => {
        assert.ok(ignored("pipeline/__pycache__/x.pyc"));
    });

    test("keeps the hook source tracked", () => {
        assert.ok(!ignored(".claude/hooks/check-file.py"));
    });
});
