/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cucumber support for the editor: each scenario launches the built Electron app
// through Playwright's Electron launcher on its own temporary deck, with HOME pointed
// at a fresh directory so that settings and preferences never leak between runs.
// No BeforeAll: the Chromium world in world.js is untouched.

import {After} from "@cucumber/cucumber";
import fs from "node:fs";
import {createRequire} from "node:module";
import os from "node:os";
import path from "node:path";
import {_electron} from "playwright";

const require = createRequire(import.meta.url);
const {withTempDeck} = require("../../cli/helpers.js");

const root = path.resolve(import.meta.dirname, "..", "..", "..");

/** How long closeEditor waits for Ctrl+S to rewrite the presentation file. */
const SAVE_WAIT_MS = 5000;

/** How long closeEditor waits for the app to quit before killing it. */
const CLOSE_WAIT_MS = 5000;

/** @typedef {{dir: string, svg: string, json: string, cleanup: Function}} TempDeck */
/** @typedef {{app: import("playwright").ElectronApplication, window: import("playwright").Page, deck: TempDeck, home: string}} Editor */

/** @type {Set<Editor>} */
const openEditors = new Set();

/** Copy a fixture deck into a temporary directory and open it in the editor.
 *
 * @param {string} fixture - The fixture name under test/fixtures.
 * @returns {Promise<Editor>} - The running app, its window, the deck and the temporary HOME.
 */
export async function launchEditor(fixture) {
    const deck = withTempDeck(fixture);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-editor-home-"));
    const app = await _electron.launch({
        // The editor opens the last argument as the deck.
        args: [path.join(root, "build", "electron"), deck.svg],
        env: {...process.env, HOME: home, ELECTRON_ENABLE_LOGGING: "1"}
    });
    const window = await app.firstWindow();
    const editor = {app, window, deck, home};
    openEditors.add(editor);
    await window.locator(".timeline-top-right th.frame-index").first().waitFor();
    return editor;
}

/** Save the deck with Ctrl+S, wait for the presentation file to change, then quit.
 *
 * Saving first means the close never reaches the save dialog of backend/Electron.js.
 * Opening a deck marks it as needing a save, so Ctrl+S rewrites the presentation file
 * even when the scenario changed nothing; the wait is bounded in case it does not.
 * The app is closed whatever happens to the save, and killed if it does not quit in time.
 *
 * @param {Editor} editor - An editor returned by launchEditor.
 */
export async function closeEditor(editor) {
    if (!openEditors.delete(editor)) {
        return;
    }
    const {app, window, deck, home} = editor;
    try {
        const before = fs.statSync(deck.json).mtimeMs;
        await window.keyboard.press("Control+S");
        const deadline = Date.now() + SAVE_WAIT_MS;
        while (fs.statSync(deck.json).mtimeMs === before && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    } catch (err) {
        console.warn(`closeEditor: save before close failed: ${err}`);
    } finally {
        await closeApp(app);
        deck.cleanup();
        fs.rmSync(home, {recursive: true, force: true});
    }
}

/** Quit the app, or kill its process if it has not quit within CLOSE_WAIT_MS.
 *
 * A quit dialog would otherwise hold the step until cucumber's timeout and leak the process.
 *
 * @param {import("playwright").ElectronApplication} app - The running app.
 */
async function closeApp(app) {
    let timer;
    const timedOut = new Promise(resolve => {
        timer = setTimeout(() => resolve(true), CLOSE_WAIT_MS);
    });
    const closed = app.close().then(
        () => false,
        () => false
    );
    if (await Promise.race([closed, timedOut])) {
        console.warn(`closeEditor: the editor did not quit within ${CLOSE_WAIT_MS} ms; killing it`);
        app.process().kill("SIGKILL");
    }
    clearTimeout(timer);
}

After(async function () {
    for (const editor of [...openEditors]) {
        await closeEditor(editor);
    }
});
