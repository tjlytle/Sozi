/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cucumber support: one Chromium for the run, one browser context per scenario,
// decks built once by the real CLI and reused. Scenarios drive the built presenter
// and display pages through Playwright (standard 6.2).

import {
    After,
    AfterAll,
    Before,
    BeforeAll,
    setDefaultTimeout,
    setWorldConstructor
} from "@cucumber/cucumber";
import fs from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "playwright";

const require = createRequire(import.meta.url);
const {runSozi, withTempDeck} = require("../../cli/helpers.js");

const root = path.resolve(import.meta.dirname, "..", "..", "..");
export const SCREENSHOTS = path.join(root, "build", "features", "screenshots");

setDefaultTimeout(30000);

/** @type {import("playwright").Browser} */
let browser;
/** @type {Map<string, {dir: string, html: string, presenter: string, cleanup: Function}>} */
const decks = new Map();

/** The built deck for a fixture, building it with the CLI on first use.
 *
 * @param {string} name - The fixture name under test/fixtures.
 * @returns {{dir: string, html: string, presenter: string}} - Where the built pages are.
 */
export function builtDeck(name) {
    if (!decks.has(name)) {
        const deck = withTempDeck(name);
        const run = runSozi(["build", path.basename(deck.svg)], {cwd: deck.dir});
        if (run.code !== 0) {
            throw new Error(`sozi build ${name} failed:\n${run.stdout}\n${run.stderr}`);
        }
        const base = deck.svg.replace(/\.svg$/, "");
        decks.set(name, {
            dir: deck.dir,
            html: base + ".sozi.html",
            presenter: base + "-presenter.sozi.html",
            cleanup: deck.cleanup
        });
    }
    return decks.get(name);
}

/** What a scenario can reach: the browser context, the presenter page and the audience window. */
export class SoziWorld {
    /** A scenario starts with nothing open. */
    constructor() {
        /** @type {import("playwright").BrowserContext} */
        this.context = null;
        /** @type {import("playwright").Page} */
        this.presenter = null;
        /** @type {import("playwright").Page} */
        this.audience = null;
        /** @type {any} */
        this.deck = null;
        /** @type {string} */
        this.fixture = "";
    }

    /** Open the exported player page of a built deck and wait for window.sozi.
     *
     * @param {string} fixture - The fixture name.
     */
    async openDeck(fixture) {
        const deck = builtDeck(fixture);
        this.deck = await this.context.newPage();
        await this.deck.goto(pathToFileURL(deck.html).href);
        await this.deck.waitForFunction(() =>
            Boolean(/** @type {any} */ (window).sozi?.player?.currentFrame)
        );
    }

    /** Open the presenter page of a built deck and wait for the audience window it opens.
     *
     * @param {string} fixture - The fixture name.
     */
    async openPresenter(fixture) {
        const deck = builtDeck(fixture);
        this.presenter = await this.context.newPage();
        const popup = this.presenter.waitForEvent("popup");
        await this.presenter.goto(pathToFileURL(deck.presenter).href);
        this.audience = await popup;
        await this.audience.waitForLoadState("load");
    }
}

setWorldConstructor(SoziWorld);

BeforeAll(async () => {
    browser = await chromium.launch();
    fs.mkdirSync(SCREENSHOTS, {recursive: true});
});

Before(async function () {
    this.context = await browser.newContext({viewport: {width: 1280, height: 800}});
});

After(async function (scenario) {
    if (scenario.result?.status === "FAILED" && this.presenter) {
        const file = path.join(
            SCREENSHOTS,
            `failed-${scenario.pickle.name.replace(/\W+/g, "-")}.png`
        );
        await this.presenter.screenshot({path: file});
        this.attach(fs.readFileSync(file), "image/png");
    }
    await this.context?.close();
});

AfterAll(async () => {
    await browser?.close();
    for (const deck of decks.values()) {
        deck.cleanup();
    }
});
