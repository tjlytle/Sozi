/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for add-ons (#27): a panel registered from the console, a fake transport on the
// presenter page, which page loaded which custom file, and the pairing overlay.

import {Given, Then, When} from "@cucumber/cucumber";
import fs from "node:fs";
import path from "node:path";
import {expect} from "playwright/test";
import {applyExample, exampleFiles} from "../support/docExample.js";
import {buildDeck, copyDeck, registerBuiltDeck} from "../support/world.js";

// The repository, where a guide's path starts.
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

// The element of src/templates/player.html that holds an add-on's pairing.
const PAIRING = ".sozi-pairing";

/** The custom files that left their name on a page, sorted.
 *
 * @param {import("playwright").Page} page - The page.
 * @returns {Promise<string[]>} - The names test/fixtures/addons/marker*.js wrote.
 */
function loadedAddons(page) {
    return page.evaluate(() => {
        const {addonMarkers = []} = /** @type {any} */ (window);
        return [...addonMarkers].sort();
    });
}

/** The names a step lists in one comma-separated string, sorted.
 *
 * @param {string} list - The names, separated by commas.
 * @returns {string[]} - The names.
 */
function namesIn(list) {
    return list
        .split(",")
        .map(name => name.trim())
        .sort();
}

/** Put a fake transport in a page as `window.fakeTransport`; it runs inside the page.
 *
 * It is what a transport is (src/js/protocol/LocalTransport.js), with no window behind it.
 */
export function installFakeTransport() {
    const listeners = new Set();
    /** @type {any} */ (window).fakeTransport = {
        status: "connected",
        sent: [],
        send(message) {
            this.sent.push(message);
            return true;
        },
        onMessage(handler) {
            listeners.add(handler);
            return () => listeners.delete(handler);
        },
        on() {},
        off() {},
        dispose() {
            listeners.clear();
        },
        deliver(message) {
            listeners.forEach(handler => handler(message));
        }
    };
}

Given("the {string} deck is built with the worked example of {string}", function (fixture, doc) {
    const guide = path.join(ROOT, doc);
    if (!fs.existsSync(guide)) {
        throw new Error(`${doc} does not exist, so it has no worked example to build`);
    }
    const example = exampleFiles(fs.readFileSync(guide, "utf8"));
    if (Object.keys(example.files).length === 0) {
        throw new Error(`${doc} has no code block that names a file`);
    }
    const deck = copyDeck(fixture);
    applyExample(deck, example);
    const name = `${fixture} with the worked example`;
    registerBuiltDeck(name, buildDeck(deck));
    this.fixture = name;
});

When("a panel {string} is registered from the console", async function (title) {
    await this.presenter.evaluate(panelTitle => {
        const {presenter} = /** @type {any} */ (window).sozi;
        presenter.registerPanel({
            id: panelTitle.toLowerCase(),
            title: panelTitle,
            render(element) {
                const root = element.ownerDocument.createElement("div");
                root.dataset.addonPanel = panelTitle;
                // Only what the panel finds in the state: it listens to nothing.
                root.textContent = `frame ${presenter.state.frame.index + 1}`;
                element.append(root);
                return () => root.remove();
            }
        });
    }, title);
});

When("a fake transport is registered on the presenter page", async function () {
    await this.presenter.evaluate(installFakeTransport);
    await this.presenter.evaluate(() => {
        const {sozi, fakeTransport} = /** @type {any} */ (window);
        sozi.presenter.registerTransport(fakeTransport);
    });
});

When("the fake transport delivers a frame change to index {int}", async function (index) {
    await this.presenter.evaluate(i => {
        /** @type {any} */ (window).fakeTransport.deliver({
            name: "frameChange",
            index: i,
            id: "frame2",
            title: "Two",
            notes: ""
        });
    }, index);
});

Then("the fake transport received {string} with index {int}", async function (name, index) {
    await expect
        .poll(() =>
            this.presenter.evaluate(
                ([n, i]) =>
                    /** @type {any} */ (window).fakeTransport.sent.some(
                        message => message.name === n && message.index === i
                    ),
                [name, index]
            )
        )
        .toBe(true);
});

Then("the presenter page loaded the add-ons {string}", async function (list) {
    await expect.poll(() => loadedAddons(this.presenter)).toEqual(namesIn(list));
});

Then("the audience window loaded the add-ons {string}", async function (list) {
    await expect.poll(() => loadedAddons(this.audience)).toEqual(namesIn(list));
});

Then("the pairing overlay shows {string}", async function (text) {
    const overlay = this.deck.locator(PAIRING);
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(text);
});

Then("the pairing overlay is hidden", async function () {
    // The overlay is in the page but hidden, so a page without one does not pass.
    const overlay = this.deck.locator(PAIRING);
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toBeHidden();
});
