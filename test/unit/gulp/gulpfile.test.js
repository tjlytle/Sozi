import {test, describe} from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);

const TASKS = [
    "all",
    "browserBuild",
    "default",
    "electronBuild",
    "extras",
    "jsdoc",
    "package",
    "packageLinux",
    "shell"
];

describe("gulpfile", () => {
    test("exports the nine build tasks, each a function", () => {
        const tasks = require(path.join(ROOT, "gulpfile.js"));
        assert.deepEqual(Object.keys(tasks).sort(), TASKS);
        for (const name of TASKS) {
            assert.equal(typeof tasks[name], "function", name);
        }
    });

    test("puts the build together from the modules under gulp/", () => {
        require(path.join(ROOT, "gulpfile.js"));
        const fromGulpDir = Object.keys(require.cache).filter(file =>
            file.startsWith(path.join(ROOT, "gulp") + path.sep)
        );
        assert.ok(fromGulpDir.length > 0, "gulpfile.js requires no module under gulp/");
    });
});
