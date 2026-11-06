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
    setWorldConstructor,
    World
} from "@cucumber/cucumber";
import fs from "node:fs";
import {createRequire} from "node:module";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "playwright";
import {serveDirectory} from "./server.js";

const require = createRequire(import.meta.url);
const {runSozi, withTempDeck} = require("../../cli/helpers.js");

const root = path.resolve(import.meta.dirname, "..", "..", "..");
export const SCREENSHOTS = path.join(root, "build", "features", "screenshots");

setDefaultTimeout(30000);

/** The size of every page a scenario opens. */
const VIEWPORT = {width: 1280, height: 800};

/** @type {import("playwright").Browser} */
let browser;
/** @type {Map<string, {dir: string, svg: string, html: string, presenter: string, cleanup: Function}>} */
const decks = new Map();

/** Build a deck in its directory with the CLI.
 *
 * @param {string} name - The fixture name, for the error.
 * @param {{dir: string, svg: string}} deck - Where the deck is.
 */
function buildDeck(name, {dir, svg}) {
    const run = runSozi(["build", path.basename(svg)], {cwd: dir});
    if (run.code !== 0) {
        throw new Error(`sozi build ${name} failed:\n${run.stdout}\n${run.stderr}`);
    }
}

/** The built deck for a fixture, building it with the CLI on first use.
 *
 * @param {string} name - The fixture name under test/fixtures.
 * @returns {{dir: string, svg: string, html: string, presenter: string}} - Where the built
 *     pages are.
 */
export function builtDeck(name) {
    if (!decks.has(name)) {
        const deck = withTempDeck(name);
        buildDeck(name, deck);
        const base = deck.svg.replace(/\.svg$/, "");
        decks.set(name, {
            dir: deck.dir,
            svg: deck.svg,
            html: base + ".sozi.html",
            presenter: base + "-presenter.sozi.html",
            cleanup: deck.cleanup
        });
    }
    // Cast: the deck was built above if it was missing.
    return /** @type {{dir: string, svg: string, html: string, presenter: string}} */ (
        decks.get(name)
    );
}

/** Remove the notes file of a built deck and build it again, in place.
 *
 * The deck's pages stay where they are, for the page already open on them. A later scenario
 * that asks for this fixture gets a fresh copy, with its notes file.
 *
 * @param {string} name - The fixture name.
 */
export function rebuildWithoutNotesFile(name) {
    const deck = builtDeck(name);
    fs.rmSync(path.join(deck.dir, `${name}.notes.md`));
    buildDeck(name, deck);
    decks.delete(name);
    decks.set(`${name} without its notes file`, deck);
}

/** What a scenario can reach: the browser context, the pages it opened, the dialogs they
 * showed, the deck's first view and Cucumber's attach.
 */
export class SoziWorld extends World {
    /** A scenario starts with nothing open.
     *
     * @param {import("@cucumber/cucumber").IWorldOptions} options - Cucumber's attach, log,
     *     link and parameters, handed on to World.
     */
    constructor(options) {
        super(options);
        /** @type {?import("playwright").BrowserContext} */
        this.context = null;
        /** @type {?import("playwright").Page} */
        this.presenter = null;
        /** @type {?import("playwright").Page} */
        this.audience = null;
        /** @type {?import("playwright").Page} */
        this.deck = null;
        /** @type {string} */
        this.fixture = "";
        /** Where the deck page looked when it opened, for the steps that check the view.
         *
         * @type {?{cx: number, cy: number, width: number, angle: number}}
         */
        this.initialView = null;
        /** The message of every dialog a page of the scenario showed, in order.
         *
         * @type {string[]}
         */
        this.dialogs = [];
        /** The font size of the notes before a step changed it, in pixels.
         *
         * @type {number}
         */
        this.notesFontSize = 0;
        /** The copy of a deck this scenario serves over http.
         *
         * @type {?{presenter: string, dir: string, close: () => Promise<void>}}
         */
        this.served = null;
    }

    /** Open the exported player page of a built deck and wait for window.sozi.
     *
     * A touch screen replaces the scenario's context with one that has touch support,
     * so that the page receives real touch events.
     *
     * @param {string} fixture - The fixture name.
     * @param {{touch?: boolean}} [options] - Whether the page is on a touch screen.
     */
    async openDeck(fixture, {touch = false} = {}) {
        const deck = builtDeck(fixture);
        if (touch) {
            await this.context?.close();
            this.context = await browser.newContext({viewport: VIEWPORT, hasTouch: true});
        }
        // Cast: the Before hook opens a context for every scenario.
        this.deck = await /** @type {import("playwright").BrowserContext} */ (
            this.context
        ).newPage();
        await this.deck.goto(pathToFileURL(deck.html).href);
        await this.deck.waitForFunction(() =>
            Boolean(/** @type {any} */ (window).sozi?.player?.currentFrame)
        );
        // The blank screen fades out over half a second; until then it takes the pointer
        // and the touches meant for the slide.
        await this.deck.waitForFunction(() => {
            const blank = document.querySelector(".sozi-blank-screen");
            return !blank || getComputedStyle(blank).visibility === "hidden";
        });
        this.initialView = await this.readView();
    }

    /** Where the deck page's first camera looks, through window.sozi.
     *
     * @returns {Promise<{cx: number, cy: number, width: number, angle: number}>} - The
     *     camera's centre, width and angle.
     */
    readView() {
        // Cast: openDeck opened the deck page.
        return /** @type {import("playwright").Page} */ (this.deck).evaluate(() => {
            const {cx, cy, width, angle} = /** @type {any} */ (window).sozi.viewport.cameras[0];
            return {cx, cy, width, angle};
        });
    }

    /** Open the presenter page of a built deck and wait for the audience window it opens.
     *
     * @param {string} fixture - The fixture name.
     */
    async openPresenter(fixture) {
        await this.openPresenterAt(pathToFileURL(builtDeck(fixture).presenter).href);
    }

    /** Open a presenter page from its address and wait for the audience window it opens.
     *
     * @param {string} href - The page's address.
     */
    async openPresenterAt(href) {
        // Cast: the Before hook opens a context for every scenario.
        this.presenter = await /** @type {import("playwright").BrowserContext} */ (
            this.context
        ).newPage();
        const popup = this.presenter.waitForEvent("popup");
        await this.presenter.goto(href);
        this.audience = await popup;
        await this.audience.waitForLoadState("load");
    }

    /** Serve a copy of a built deck over http until the scenario ends.
     *
     * The notes file goes into the copy after the build, as a published file does.
     *
     * @param {string} fixture - The fixture name.
     * @param {string} [notesFile] - The text of a notes file beside the deck.
     */
    async serveDeck(fixture, notesFile) {
        const deck = builtDeck(fixture);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-served-"));
        fs.cpSync(deck.dir, dir, {recursive: true});
        if (notesFile !== undefined) {
            fs.writeFileSync(path.join(dir, `${fixture}.notes.md`), notesFile);
        }
        const {url, close} = await serveDirectory(dir);
        this.served = {presenter: `${url}/${path.basename(deck.presenter)}`, dir, close};
    }
}

setWorldConstructor(SoziWorld);

BeforeAll(async () => {
    // Media may play without a gesture, so that a clip starting too early is seen to start.
    browser = await chromium.launch({args: ["--autoplay-policy=no-user-gesture-required"]});
    fs.mkdirSync(SCREENSHOTS, {recursive: true});
});

Before(async function () {
    this.context = await browser.newContext({viewport: VIEWPORT});
    // Record every alert, confirm or prompt, then dismiss it so that the page goes on.
    this.context.on("page", page =>
        page.on("dialog", dialog => {
            this.dialogs.push(dialog.message());
            dialog.dismiss().catch(() => {});
        })
    );
});

After(async function (scenario) {
    // A player scenario opens only the deck page; a presenter scenario has both.
    const page = this.presenter ?? this.deck;
    if (scenario.result?.status === "FAILED" && page) {
        const file = path.join(
            SCREENSHOTS,
            `failed-${scenario.pickle.name.replace(/\W+/g, "-")}.png`
        );
        await page.screenshot({path: file});
        await this.attach(fs.readFileSync(file), "image/png");
    }
    await this.context?.close();
    if (this.served) {
        await this.served.close();
        fs.rmSync(this.served.dir, {recursive: true, force: true});
    }
});

AfterAll(async () => {
    await browser?.close();
    for (const deck of decks.values()) {
        deck.cleanup();
    }
});
