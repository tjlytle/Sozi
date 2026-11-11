/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests of the ESLint configuration: each rule of standard 2 fires in
// the files it is meant for and stays quiet in the files that are exempt. Flat config
// replaces a rule's whole configuration when a later block sets it again, which is how
// these rules once switched each other off silently.

import {test, describe, before, after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {ESLint} from "eslint";

const root = path.resolve(import.meta.dirname, "..", "..");
const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: path.join(root, "config", "eslintrc.mjs")
});

/** Lint a snippet as if it lived at a path, and return the messages of the rules of interest.
 *
 * @param {string} filePath - The path, relative to the repository, the snippet pretends to be.
 * @param {string} code - The snippet.
 * @returns {Promise<string[]>} - The messages that mention the standard.
 */
async function standardMessages(filePath, code) {
    const [result] = await eslint.lintText(code, {filePath: path.join(root, filePath)});
    return result.messages.map(m => m.message).filter(m => m.includes("standard "));
}

const fires = async (filePath, code, section) =>
    assert.ok(
        (await standardMessages(filePath, code)).some(m => m.includes(section)),
        `${section} should fire in ${filePath}`
    );
const quiet = async (filePath, code, section) =>
    assert.ok(
        !(await standardMessages(filePath, code)).some(m => m.includes(section)),
        `${section} should be quiet in ${filePath}`
    );

describe("2.2 function modules do not touch the DOM", () => {
    const code = "export function f() { return window.innerWidth; }\n";
    test("fires in a lowercase module", () => fires("src/js/layout.js", code, "2.2"));
    test("quiet in a class module", () => quiet("src/js/Layout.js", code, "2.2"));
    test("quiet in an entry point", () => quiet("src/js/presenter.js", code, "2.2"));
});

/** Make a throwaway root the type-aware rules can lint a real file in, so a concurrent lint of
 * the live tree never finds a fixture that is gone before it reads it. config/ is a copy, not a
 * link: eslintrc.mjs sets tsconfigRootDir from its own directory, and a linked module resolves
 * to the live tree.
 *
 * @returns {string} - The scratch root, with config/, tsconfig.json, node_modules and src/js.
 */
function scratchRoot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-eslint-"));
    for (const name of ["config", "tsconfig.json"]) {
        fs.cpSync(path.join(root, name), path.join(dir, name), {recursive: true});
    }
    fs.symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"), "dir");
    fs.mkdirSync(path.join(dir, "src", "js"), {recursive: true});
    return dir;
}

/** The path the floating-promise test writes its TypeScript fixture to.
 *
 * @param {string} scratch - The scratch root from scratchRoot().
 * @returns {string} - An absolute path under the scratch root's src/js.
 */
function floatingFixture(scratch) {
    return path.join(scratch, "src", "js", "zz-floating.ts");
}

describe("2.7 no blocking dialogs, no floating promises", () => {
    const code = 'export function f() { alert("x"); }\n';
    let scratch = "";
    before(() => {
        scratch = scratchRoot();
    });
    after(() => fs.rmSync(scratch, {recursive: true, force: true}));
    test("alert fires in a class module", () => fires("src/js/Panel.js", code, "2.7"));
    test("alert fires in a function module, alongside the DOM ban", async () => {
        const messages = await standardMessages(
            "src/js/layout.js",
            "export function f() { alert(window.name); }\n"
        );
        assert.ok(
            messages.some(m => m.includes("2.7")) && messages.some(m => m.includes("2.2")),
            messages.join("\n")
        );
    });
    test("the TypeScript fixture is written outside the live tree", () => {
        const file = floatingFixture(scratch);
        assert.ok(path.relative(root, file).startsWith(".."), file);
    });
    test("an unawaited promise fires in a TypeScript file", async () => {
        const file = floatingFixture(scratch);
        const scratchLint = new ESLint({
            cwd: scratch,
            overrideConfigFile: path.join(scratch, "config", "eslintrc.mjs")
        });
        fs.writeFileSync(
            file,
            "export async function f(): Promise<void> {}\nexport function g(): void { f(); }\n"
        );
        try {
            const [result] = await scratchLint.lintFiles([file]);
            assert.ok(
                result.messages.some(m => m.ruleId === "@typescript-eslint/no-floating-promises"),
                JSON.stringify(result.messages)
            );
        } finally {
            fs.unlinkSync(file);
        }
    });
});

describe("2.3 only the publishers assign window properties", () => {
    const code = "window.sozi = {};\n";
    test("fires in an ordinary module", () => fires("src/js/Controller.js", code, "2.3"));
    test("quiet in player.js", () => quiet("src/js/player.js", code, "2.3"));
    test("quiet in presenter.js", () => quiet("src/js/presenter.js", code, "2.3"));
});

describe("2.4 event names come from a table", () => {
    const code = 'export function f(e) { e.on("frameChange", () => {}); }\n';
    test("fires in deck code", () => fires("src/js/player/Player.js", code, "2.4"));
    test("fires in a publisher", () => fires("src/js/player.js", code, "2.4"));
    test("quiet in Electron glue", () => quiet("src/js/index-electron.js", code, "2.4"));
    test("quiet in the Electron backend", () => quiet("src/js/backend/Electron.js", code, "2.4"));
});

describe("2.5 only the protocol module posts messages", () => {
    const code = 'export function f(w) { w.postMessage({name: "x"}, "*"); }\n';
    test("fires in a surface", () => fires("src/js/presenter.js", code, "2.5"));
    test("fires in Electron glue", () => fires("src/js/exporter/index-electron.js", code, "2.5"));
    test("quiet in the protocol module", () => quiet("src/js/protocol/messages.js", code, "2.5"));
});

describe("3.3 inline styles only for computed geometry", () => {
    test("an appearance property fires", () =>
        fires(
            "src/js/presenter/Panel.js",
            'export function f(el) { el.style.color = "red"; }\n',
            "3.3"
        ));
    test("a geometry property is quiet", () =>
        quiet(
            "src/js/presenter/Panel.js",
            'export function f(el, w) { el.style.width = w + "px"; }\n',
            "3.3"
        ));
    test("fires in Electron glue too", () =>
        fires(
            "src/js/index-electron.js",
            'export function f(el) { el.style.background = "x"; }\n',
            "3.3"
        ));
});

describe("2.6 only the sanitizer parses HTML", () => {
    const code = "export function f(el, s) { el.innerHTML = s; }\n";
    test("fires in a surface", () => fires("src/js/presenter.js", code, "2.6"));
    test("fires in the protocol module", () => fires("src/js/protocol/messages.js", code, "2.6"));
    test("quiet in the sanitizer module", () => quiet("src/js/html/markdown.js", code, "2.6"));
});

/** Lint a snippet as if it lived at a path, and return its parsing errors.
 *
 * @param {string} filePath - The path, relative to the repository, the snippet pretends to be.
 * @param {string} code - The snippet.
 * @returns {Promise<import("eslint").Linter.LintMessage[]>} - The fatal messages.
 */
async function fatalMessages(filePath, code) {
    const [result] = await eslint.lintText(code, {filePath: path.join(root, filePath)});
    return result.messages.filter(m => m.fatal);
}

describe("1.2 src/js stays at the syntax jspot parses", () => {
    const chaining = "export const f = a => a?.b;\n";
    test("optional chaining fails to parse in src/js", async () =>
        assert.notEqual((await fatalMessages("src/js/model/probe.js", chaining)).length, 0));
    test("nullish coalescing fails to parse in src/js", async () =>
        assert.notEqual(
            (await fatalMessages("src/js/model/probe.js", "export const f = a => a ?? 1;\n"))
                .length,
            0
        ));
    test("a class field fails to parse in src/js", async () =>
        assert.notEqual(
            (await fatalMessages("src/js/model/A.js", "export class A {\n    x = 1;\n}\n")).length,
            0
        ));
    test("optional chaining parses in a test", async () =>
        assert.deepEqual(await fatalMessages("test/unit/probe.test.js", chaining), []));
    test("ES2022 globals stay defined in src/js", async () => {
        const code =
            "/** @type {Window & typeof globalThis} */\n" +
            "export const w = /** @type {any} */ (window);\n" +
            "export const r = new WeakRef({});\n";
        const [result] = await eslint.lintText(code, {
            filePath: path.join(root, "src/js/model/probe.js")
        });
        const rules = result.messages.map(m => m.ruleId);
        assert.ok(
            !rules.includes("jsdoc/no-undefined-types") && !rules.includes("no-undef"),
            JSON.stringify(result.messages)
        );
    });
});
