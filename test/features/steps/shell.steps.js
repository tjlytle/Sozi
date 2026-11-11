/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the hosted shell (#29): serving it with the stand-in relay, opening pairing links
// on a phone and a laptop, and reading what the shell says.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {expect} from "playwright/test";
import {tabOf, WAIT} from "../support/panels.js";

/** @typedef {import("../support/world.js").SoziWorld} SoziWorld */

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
// What `npx gulp` writes.
const BUILT_SHELL = path.join(ROOT, "build", "shell");
// What the host of the scenarios drops in place of the empty addons.js.
const FAKE_RELAY = path.join(ROOT, "test", "fixtures", "shell", "fake-relay.js");

// What src/templates/presenter.html draws for the shell.
const NOTICE = ".sozi-connection-notice";
const SHELL_TITLE = "Sozi presenter";

// The size of each device a scenario opens the shell on.
const DEVICES = Object.freeze({
    phone: {width: 390, height: 844},
    laptop: {width: 1280, height: 800}
});

/** The fragment of a pairing link.
 *
 * @param {string} deck - The deck's address.
 * @param {string} session - The session.
 * @returns {string} - The fragment, with its "#".
 */
function pairingHash(deck, session) {
    return `#deck=${encodeURIComponent(deck)}&session=${encodeURIComponent(session)}`;
}

/** Open the shell in a new page of the scenario's context.
 *
 * Devices share the context, because a BroadcastChannel reaches no further. The first page
 * is the scenario's presenter page, the one a screenshot shows.
 *
 * @param {SoziWorld} world - The scenario.
 * @param {string} device - A name in DEVICES.
 * @param {string} hash - The fragment of the address.
 * @returns {Promise<void>} - Resolves when the page has loaded.
 */
async function openShell(world, device, hash) {
    // Cast: the Before hook opens a context for every scenario.
    const page = await /** @type {import("playwright").BrowserContext} */ (world.context).newPage();
    await page.setViewportSize(DEVICES[device]);
    await page.goto(world.shellUrl + hash);
    world.shells[device] = page;
    world.presenter ??= page;
}

/** Check the frame counter of a device.
 *
 * @param {import("playwright").Page} page - The shell's page.
 * @param {string} text - What it reads, like "1 / 2".
 * @param {number} [timeout] - How long it has, in milliseconds.
 */
async function expectCounter(page, text, timeout = WAIT.timeout) {
    const [index, length] = text.split("/").map(part => part.trim());
    await expect(page.locator(".sozi-current-index")).toHaveText(index, {timeout});
    await expect(page.locator(".sozi-presentation-length")).toHaveText(length, {timeout});
}

Given("the {string} deck is built and served", async function (fixture) {
    await this.serveDeck(fixture);
    this.fixture = fixture;
});

Given("the presenter shell is served at {string} with the fake relay", function (shellPath) {
    const dir = path.join(this.served.dir, shellPath);
    fs.mkdirSync(dir, {recursive: true});
    // A build with no shell serves a 404, and the scenarios fail on what they look for.
    if (fs.existsSync(BUILT_SHELL)) {
        fs.cpSync(BUILT_SHELL, dir, {recursive: true});
    }
    fs.copyFileSync(FAKE_RELAY, path.join(dir, "addons.js"));
    this.shellUrl = this.served.url + shellPath;
});

Given("the deck page is open on the fake relay session {string}", async function (session) {
    await this.loadDeck(`${this.served.html}?session=${encodeURIComponent(session)}`);
});

Given(
    "the shell has been opened once with the pairing link for session {string}",
    async function (session) {
        const world = /** @type {SoziWorld} */ (this);
        await openShell(world, "laptop", pairingHash(this.served.html, session));
        // Installed: the worker has its files, so that the next load needs no network.
        await expect
            .poll(
                () =>
                    this.presenter.evaluate(async () => {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        return registrations.some(({active}) => active?.state === "activated");
                    }),
                {message: "the shell has an active service worker", ...WAIT}
            )
            .toBe(true);
    }
);

When(
    "the shell is opened on a {word} with the pairing link for session {string}",
    async function (device, session) {
        const world = /** @type {SoziWorld} */ (this);
        await openShell(world, device, pairingHash(this.served.html, session));
    }
);

When("the shell is opened without a pairing link", async function () {
    await openShell(/** @type {SoziWorld} */ (this), "laptop", "");
});

When("the shell is opened with a pairing link whose deck is {string}", async function (deck) {
    await openShell(/** @type {SoziWorld} */ (this), "laptop", pairingHash(deck, "s1"));
});

When("the browser goes offline", async function () {
    await this.context.setOffline(true);
});

When("the shell is reloaded", async function () {
    await this.presenter.reload();
});

When("the shell's relay reports {string}", async function (status) {
    const page = this.presenter;
    // The fixture registers the relay once the page has loaded.
    await page.waitForFunction(() => Boolean(/** @type {any} */ (window).fakeRelay), null, WAIT);
    await page.evaluate(next => /** @type {any} */ (window).fakeRelay.report(next), status);
});

When("the next button is pressed on the {word}", async function (device) {
    const page = this.shells[device];
    // On a phone the panels are tabs, and the button is behind the Controls tab.
    await tabOf(page, "Controls").click(WAIT);
    await page.locator("#sozi-next-btn").click(WAIT);
});

Then(
    "within {int} seconds the {word}'s frame counter reads {string}",
    async function (seconds, device, text) {
        await expectCounter(this.shells[device], text, seconds * 1000);
    }
);

Then("the {word}'s frame counter reads {string}", async function (device, text) {
    await expectCounter(this.shells[device], text);
});

Then("every preview on the {word} shows the {string} deck", async function (device, fixture) {
    const page = this.shells[device];
    const deck = `${this.served.url}/${fixture}.sozi.html`;
    const iframes = await page.locator("iframe").elementHandles();
    assert.notEqual(iframes.length, 0, "the shell has previews");
    for (const iframe of iframes) {
        const frame = await iframe.contentFrame();
        assert.ok(frame, "the preview has a window");
        await expect.poll(() => frame.url().split("#")[0]).toBe(deck);
        await expect
            .poll(() => frame.evaluate(() => Boolean(/** @type {any} */ (window).sozi?.player)))
            .toBe(true);
    }
});

Then("the deck page is on frame {string}", async function (title) {
    await expect
        .poll(() => this.deck.evaluate(() => window.sozi.player.currentFrame.title))
        .toBe(title);
});

Then("the shell shows {string}", async function (text) {
    const notice = this.presenter.locator(NOTICE);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(text);
});

Then("the shell's notice is hidden", async function () {
    await expect(this.presenter.locator(NOTICE)).toBeHidden(WAIT);
});

Then("the page title is the shell's", async function () {
    await expect(this.presenter).toHaveTitle(SHELL_TITLE);
});

Then("no preview has loaded", async function () {
    // An iframe pointed at a javascript: address stays on about:blank, so the attribute counts.
    const sources = await this.presenter
        .locator("iframe")
        .evaluateAll(iframes => iframes.map(iframe => iframe.getAttribute("src")));
    assert.deepEqual(sources.filter(Boolean), [], "a preview was given an address");
    const loaded = this.presenter
        .frames()
        .filter(frame => frame !== this.presenter.mainFrame() && frame.url() !== "about:blank");
    assert.deepEqual(
        loaded.map(frame => frame.url()),
        []
    );
});
