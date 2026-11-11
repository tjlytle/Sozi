/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for a second surface on one talk: another presenter page, with no audience window of its
// own, joined to the audience window by a fake transport on each side, bridged through Playwright.

import {Given, When} from "@cucumber/cucumber";
import {expect} from "playwright/test";
import {installFakeTransport} from "./addons.steps.js";
import {WAIT} from "../support/panels.js";

// What the second surface calls to reach the display, and the display to reach it.
const TO_DISPLAY = "secondSurfaceToDisplay";
const TO_SURFACE = "displayToSecondSurface";

/** Hand a message to the fake transport of a page.
 *
 * A page in the middle of a reload has none and loses the message, as a real link would. Once
 * it has loaded it says hello, and the display answers with its whole state.
 *
 * @param {import("playwright").Page} page - The page.
 * @param {any} message - The message.
 * @returns {Promise<void>} - Resolves when the page has it, or cannot have it.
 */
async function deliverTo(page, message) {
    await page
        .evaluate(sent => /** @type {any} */ (window).fakeTransport?.deliver(sent), message)
        .catch(() => {});
}

/** Register a page's end of the bridge between the second surface and the display.
 *
 * @param {import("playwright").Page} page - The page.
 * @param {string} api - The member of `window.sozi` that takes the transport.
 * @param {string} binding - What the transport sends its messages through.
 */
async function registerBridge(page, api, binding) {
    await page.evaluate(installFakeTransport);
    await page.evaluate(
        ([member, send]) => {
            const {sozi, fakeTransport} = /** @type {any} */ (window);
            fakeTransport.send = message => {
                /** @type {any} */ (window)[send](message);
                return true;
            };
            sozi[member].registerTransport(fakeTransport);
        },
        [api, binding]
    );
}

Given("a second surface is connected to the audience window", async function () {
    const surface = await this.context.newPage();
    // This page has no audience window of its own: the bridge is its only link to the display.
    await surface.addInitScript(() => {
        window.open = () => /** @type {any} */ ({focus() {}, postMessage() {}});
    });
    await surface.exposeFunction(TO_DISPLAY, message => deliverTo(this.audience, message));
    await this.audience.exposeFunction(TO_SURFACE, message => deliverTo(surface, message));
    await surface.goto(this.presenter.url());

    await this.audience.waitForFunction(() => Boolean(/** @type {any} */ (window).sozi?.display));
    await registerBridge(surface, "presenter", TO_DISPLAY);
    await registerBridge(this.audience, "display", TO_SURFACE);
    await expect(surface.locator(".sozi-current-index")).not.toBeEmpty(WAIT);
    this.secondSurface = surface;
});

When("the second surface is reloaded", async function () {
    await this.secondSurface.reload();
    await registerBridge(this.secondSurface, "presenter", TO_DISPLAY);
    await expect(this.secondSurface.locator(".sozi-current-index")).not.toBeEmpty(WAIT);
});
