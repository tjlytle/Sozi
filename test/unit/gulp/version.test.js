import {test, describe} from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);
const {soziVersion} = require(path.join(ROOT, "gulp/version.js"));

describe("soziVersion", () => {
    test("is the last commit's date and timestamp, YY.MM.DD-<timestamp>", () => {
        assert.match(soziVersion(), /^\d{2}\.\d{2}\.\d{2}-\d+$/);
    });

    test("returns the same string on every call", () => {
        assert.equal(soziVersion(), soziVersion());
    });
});
