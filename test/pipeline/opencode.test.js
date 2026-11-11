import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {adapter, usageOf} from "./harness-adapter.js";

describe("opencode adapter", () => {
    test("stubs exit 69 and say so", () => {
        for (const name of ["opencode"]) {
            const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-"));
            const r = adapter(name, [
                "run",
                "--prompt",
                "p",
                "--model",
                "m",
                "--allow",
                "a",
                "--checkout",
                out,
                "--out",
                out
            ]);
            assert.equal(r.status, 69);
            assert.match(r.stdout, new RegExp(`${name} adapter is a stub`));
            assert.deepEqual(usageOf(out), {
                tokensIn: 0,
                tokensOut: 0,
                cacheRead: 0,
                cacheWrite: 0,
                costUsd: 0,
                turns: 0,
                status: "unsupported"
            });
        }
    });

    test("stubs exit 64 on a wrong call", () => {
        for (const name of ["opencode"]) {
            assert.equal(adapter(name, ["run", "--out", os.tmpdir()]).status, 64);
        }
    });
});
