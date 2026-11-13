import {test, describe, afterEach} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);
const {templateFiles, makeTemplateTask} = require(path.join(ROOT, "gulp/templates.js"));
const originalCwd = process.cwd();
const scratchDirs = [];

/**
 * Make a scratch directory under the system temp directory, removed after the test.
 *
 * @returns {string} The path of the new directory.
 */
function scratchDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-templates-"));
    scratchDirs.push(dir);
    return dir;
}

// Leave the directory before removing it; rmSync removes the node_modules link, not its target.
afterEach(() => {
    process.chdir(originalCwd);
    for (const dir of scratchDirs.splice(0)) {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

/**
 * Run a gulp task outside gulp: it returns a stream, a promise or nothing.
 *
 * @param {Function} task - The task.
 * @returns {Promise<void>} Resolves when the task has finished.
 */
function runTask(task) {
    return new Promise((resolve, reject) => {
        const result = task();
        if (result && typeof result.on === "function") {
            result.on("finish", resolve);
            result.on("error", reject);
        } else {
            Promise.resolve(result).then(() => resolve(), reject);
        }
    });
}

describe("templateFiles", () => {
    test("returns the script's bytes and the inlined stylesheets", () => {
        const dir = scratchDir();
        const jsPath = path.join(dir, "page.js");
        fs.writeFileSync(jsPath, "console.log('page');");
        const files = templateFiles(jsPath);
        assert.deepEqual(Object.keys(files).sort(), [
            "highlightCss",
            "js",
            "markdownCss",
            "presenterCss"
        ]);
        assert.equal(
            files.presenterCss,
            fs.readFileSync(path.join(ROOT, "src/css/presenter/drawing-toolbar.css"), "utf8")
        );
        assert.equal(files.js.toString(), "console.log('page');");
        assert.deepEqual(
            files.markdownCss,
            fs.readFileSync(
                path.join(ROOT, "node_modules/github-markdown-css/github-markdown-light.css")
            )
        );
        assert.deepEqual(
            files.highlightCss,
            fs.readFileSync(path.join(ROOT, "node_modules/highlight.js/styles/github.min.css"))
        );
    });
});

describe("makeTemplateTask", () => {
    test("writes the template with the page's script inlined", async () => {
        const dir = scratchDir();
        fs.mkdirSync(path.join(dir, "src/templates"), {recursive: true});
        fs.mkdirSync(path.join(dir, "build/tmp"), {recursive: true});
        fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
        fs.symlinkSync(path.join(ROOT, "src/css"), path.join(dir, "src/css"));
        fs.writeFileSync(
            path.join(dir, "src/templates/page.html"),
            "<script>{{ js }}</script>{% raw %}{{ later }}{% endraw %}"
        );
        fs.writeFileSync(path.join(dir, "build/tmp/page.js"), "run();");
        process.chdir(dir);
        await runTask(makeTemplateTask("target", "page"));
        assert.equal(
            fs.readFileSync(path.join(dir, "build/target/src/templates/page.html"), "utf8"),
            "<script>run();</script>{{ later }}"
        );
    });
});
