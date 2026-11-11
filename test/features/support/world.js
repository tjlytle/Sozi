/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cucumber support: one Chromium for the run, one browser context per scenario, and the
// pages a scenario opens on the decks of support/decks.js. Scenarios drive the built
// presenter and display pages through Playwright (standard 6.2).

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
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "playwright";
import {expect} from "playwright/test";
import {builtDeck, removeDecks} from "./decks.js";
import {serveDirectory} from "./server.js";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
export const SCREENSHOTS = path.join(root, "build", "features", "screenshots");

setDefaultTimeout(30000);

/** The size of every page a scenario opens. */
const VIEWPORT = {width: 1280, height: 800};

/** @type {import("playwright").Browser} */
let browser;
/** The audience window a presenter page opens, once the deck has loaded in it.
 *
 * A new window can start on `about:blank`, whose own load does not count.
 *
 * @param {Promise<import("playwright").Page>} popup - The page's coming popup event.
 * @returns {Promise<import("playwright").Page>} - The audience window.
 */
export async function audienceWindow(popup) {
    const audience = await popup;
    await audience.waitForURL(url => url.protocol !== "about:", {waitUntil: "load"});
    return audience;
}

/** Keep every iframe a top-level page adds in `window.addedIframes`, even one it removes again;
 * it runs inside the page, before the page's own scripts.
 */
function recordAddedIframes() {
    if (window !== window.top) {
        return;
    }
    const added = new Set();
    /** @type {any} */ (window).addedIframes = added;
    new MutationObserver(records => {
        for (const node of records.flatMap(record => [...record.addedNodes])) {
            if (node instanceof Element) {
                const inside = [...node.querySelectorAll("iframe")];
                [...(node.localName === "iframe" ? [node] : []), ...inside].forEach(iframe =>
                    added.add(iframe)
                );
            }
        }
    }).observe(document, {childList: true, subtree: true});
}

/** What a scenario can reach: the browser context, the pages it opened, the dialogs they
 * showed, the deck's first view, the notes' font size before a change and what a click in them
 * left, the deck and the shell it serves over http and Cucumber's attach.
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
        /** The presenter's address just before a click in the notes, and the pages opened since.
         *
         * @type {{address: string, pages: import("playwright").Page[]}}
         */
        this.notesClick = {address: "", pages: []};
        /** The copy of a deck this scenario serves over http.
         *
         * @type {?{url: string, html: string, presenter: string, dir: string, close: () => Promise<void>}}
         */
        this.served = null;
        /** Where the scenario serves the hosted shell, with the trailing slash.
         *
         * @type {string}
         */
        this.shellUrl = "";
        /** The shell's page on each device the scenario opened it on.
         *
         * @type {Record<string, import("playwright").Page>}
         */
        this.shells = {};
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
        await this.loadDeck(pathToFileURL(deck.html).href);
    }

    /** Open a deck page from its address and wait for window.sozi.
     *
     * @param {string} href - The page's address.
     */
    async loadDeck(href) {
        // Cast: the Before hook opens a context for every scenario.
        this.deck = await /** @type {import("playwright").BrowserContext} */ (
            this.context
        ).newPage();
        await this.deck.goto(href);
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
     * @param {{width: number, height: number}} [size] - The page's size from its first paint.
     */
    async openPresenter(fixture, size) {
        await this.openBuiltPresenter(builtDeck(fixture), size);
    }

    /** Open the presenter page of a deck on a device that has saved nothing for it.
     *
     * @param {{presenter: string}} deck - The built deck.
     * @param {{width: number, height: number}} [size] - The page's size from its first paint.
     */
    async openPresenterOnNewDevice(deck, size) {
        await this.context?.close();
        this.context = await browser.newContext({viewport: VIEWPORT});
        await this.openBuiltPresenter(deck, size);
    }

    /** Open the presenter page of a built deck again, in a context with touch support.
     *
     * @param {string} fixture - The fixture name.
     */
    async openPresenterOnTouchScreen(fixture) {
        await this.context?.close();
        this.context = await browser.newContext({viewport: VIEWPORT, hasTouch: true});
        await this.context.addInitScript(recordAddedIframes);
        await this.openPresenter(fixture);
    }

    /** Open the presenter page of a built deck and wait for the audience window it opens.
     *
     * @param {{presenter: string}} deck - The built deck.
     * @param {{width: number, height: number}} [size] - The page's size from its first paint.
     */
    async openBuiltPresenter(deck, size) {
        await this.openPresenterAt(pathToFileURL(deck.presenter).href, size);
    }

    /** Open a presenter page from its address and wait for the audience window it opens.
     *
     * @param {string} href - The page's address.
     * @param {{width: number, height: number}} [size] - The page's size from its first paint.
     */
    async openPresenterAt(href, size) {
        // Cast: the Before hook opens a context for every scenario.
        this.presenter = await /** @type {import("playwright").BrowserContext} */ (
            this.context
        ).newPage();
        if (size) {
            await this.presenter.setViewportSize(size);
        }
        const popup = this.presenter.waitForEvent("popup");
        await this.presenter.goto(href);
        this.audience = await audienceWindow(popup);
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
        this.served = {
            url,
            html: `${url}/${path.basename(deck.html)}`,
            presenter: `${url}/${path.basename(deck.presenter)}`,
            dir,
            close
        };
    }

    /** Wait until the presenter page has heard from the display.
     *
     * The frame counter fills in when the display says hello. It is in the Controls panel, so
     * a layout that has closed that panel has no counter to look at: the workspace drawn
     * without a Controls tab is the sign instead.
     */
    async presenterIsReady() {
        // Cast: the scenario opened the presenter page.
        const page = /** @type {import("playwright").Page} */ (this.presenter);
        const counter = page.locator(".sozi-current-index:not(:empty)");
        const bar = page.getByRole("button", {name: /Add panel/});
        const tabs = page.locator(".dv-tab");
        const controls = tabs.filter({hasText: /^\s*Controls\s*$/});
        await expect
            .poll(
                async () => {
                    const drawn = (await bar.count()) > 0 && (await tabs.count()) > 0;
                    const closed = drawn && (await controls.count()) === 0;
                    return (await counter.count()) > 0 || closed;
                },
                {message: "the frame counter is filled, or + Add panel shows with Controls closed"}
            )
            .toBe(true);
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
    await this.context.addInitScript(recordAddedIframes);
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
    removeDecks();
});
