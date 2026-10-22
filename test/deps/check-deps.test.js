/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests of the dependency check (standard 4): the pure parts, no registry.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    changedPackages,
    isExactPin,
    lockedVersion,
    mentions,
    runtimeUrlLoads,
    withoutComments
} from "../../bin/check-deps.js";

describe("dependency check", () => {
    test("finds added and changed packages, runtime and dev", () => {
        const base = {dependencies: {a: "1.0.0", b: "2.0.0"}, devDependencies: {d: "1.0.0"}};
        const head = {
            dependencies: {a: "1.0.0", b: "2.1.0", c: "3.0.0"},
            devDependencies: {d: "1.0.0", e: "0.1.0"}
        };
        assert.deepEqual(changedPackages(base, head), [
            {name: "b", version: "2.1.0", runtime: true},
            {name: "c", version: "3.0.0", runtime: true},
            {name: "e", version: "0.1.0", runtime: false}
        ]);
    });
    test("accepts only exact pins", () => {
        assert.ok(isExactPin("1.2.3"));
        assert.ok(isExactPin("1.2.3-beta.1"));
        assert.ok(!isExactPin("^1.2.3"));
        assert.ok(!isExactPin("~1.2.3"));
        assert.ok(!isExactPin(">=1.0.0"));
        assert.ok(!isExactPin("github:owner/repo#tag"));
    });
    test("reads the locked version", () => {
        const lock = {packages: {"node_modules/preact": {version: "10.0.0"}}};
        assert.equal(lockedVersion(lock, "preact"), "10.0.0");
        assert.equal(lockedVersion(lock, "missing"), null);
    });
    test("a PR body must name the package as a word", () => {
        assert.ok(mentions("Adds preact (MIT, 11 KB) for the panel workspace.", "preact"));
        assert.ok(mentions("Adds @bufbuild/protobuf for the schema.", "@bufbuild/protobuf"));
        assert.ok(!mentions("Adds preact-router.", "preact"));
        assert.ok(!mentions("No dependencies.", "preact"));
    });
    test("a commented-out URL load does not count", () => {
        assert.equal(
            withoutComments('<!-- <script src="https://x/y.js"></script> -->\n<b>'),
            "\n<b>"
        );
        assert.equal(withoutComments('a();\n// import("https://x")\nb();'), "a();\n\nb();");
        assert.equal(
            withoutComments('const u = "https://x"; /* src="https://y" */'),
            'const u = "https://x"; '
        );
    });
    test("flags scripts and stylesheets loaded from a URL at run time", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-deps-"));
        try {
            fs.writeFileSync(path.join(dir, "ok.html"), '<script src="player.js"></script>\n');
            fs.writeFileSync(
                path.join(dir, "cdn.html"),
                '<script src="https://cdn.example.com/x.js"></script>\n'
            );
            fs.writeFileSync(
                path.join(dir, "dyn.js"),
                'const m = await import("https://esm.sh/x");\n'
            );
            fs.writeFileSync(
                path.join(dir, "link.js"),
                'const url = "https://sozi.baierouge.fr";\n'
            );
            fs.writeFileSync(
                path.join(dir, "off.html"),
                '<!-- <script src="https://cdn.example.com/x.js"></script> -->\n'
            );
            const found = runtimeUrlLoads(dir)
                .map(f => path.basename(f))
                .sort();
            assert.deepEqual(found, ["cdn.html", "dyn.js"]);
        } finally {
            fs.rmSync(dir, {recursive: true});
        }
    });
});
