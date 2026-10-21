/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests of the ESLint configuration: each rule of code-standard.md section 2 fires in
// the files it is meant for and stays quiet in the files that are exempt. Flat config
// replaces a rule's whole configuration when a later block sets it again, which is how
// these rules once switched each other off silently.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
    return result.messages.map(m => m.message).filter(m => m.includes("code-standard.md"));
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

describe("2.7 no blocking dialogs, no floating promises", () => {
    const code = 'export function f() { alert("x"); }\n';
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
    test("an unawaited promise fires in a TypeScript file", async () => {
        const file = path.join(root, "src", "js", "zz-floating.ts");
        fs.writeFileSync(
            file,
            "export async function f(): Promise<void> {}\nexport function g(): void { f(); }\n"
        );
        try {
            const [result] = await eslint.lintFiles([file]);
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
    test("fires in an ordinary module", () =>
        fires("src/js/exporter/exporter-preload.js", code, "2.3"));
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
    test("quiet in Electron glue too? no: it applies everywhere", () =>
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
