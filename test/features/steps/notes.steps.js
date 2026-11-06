/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the Notes panel: the notes of a frame (#241) and the notes as one document (#31).
// The controls are found as a person finds them, by the name on the button; the marker is
// `aria-current` on a section's heading or on an element that holds it.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {expect} from "playwright/test";
import {rebuildWithoutNotesFile} from "../support/world.js";

// What the Notes panel draws: the document, with an h1 per section, and the title line.
const NOTES_DOCUMENT = ".sozi-notes-body";
const NOTES_TITLE_LINE = ".sozi-notes-title";

// A part of the panel that is not there fails its step with this wait, not the step's timeout.
const NOTES_WAIT = {timeout: 5000};

// How far below the top of the scroller a heading "at the top" may sit, in pixels: the
// document's padding and the first heading's margin.
const AT_TOP_TOLERANCE = 48;

// How long the notes must stay at the top, in milliseconds, so that a late scroll is seen.
const SETTLE_MS = 300;

/** The heading of a section of the notes document.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {string} title - The frame's title.
 * @returns {import("playwright").Locator} - The h1 with exactly this title.
 */
function sectionHeading(page, title) {
    return page.locator(`${NOTES_DOCUMENT} h1`).filter({hasText: new RegExp(`^\\s*${title}\\s*$`)});
}

/** How far a heading is from the top of the element that scrolls it.
 *
 * @param {import("playwright").Locator} heading - The heading.
 * @returns {Promise<number>} - The distance in pixels, negative above the top.
 */
function headingOffset(heading) {
    return heading.evaluate(
        element => {
            let scroller = /** @type {Element} */ (element.parentElement);
            while (
                scroller.parentElement &&
                !/auto|scroll/.test(getComputedStyle(scroller).overflowY)
            ) {
                scroller = scroller.parentElement;
            }
            return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        },
        null,
        NOTES_WAIT
    );
}

/** The section headings of the notes document.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {Promise<string[]>} - The trimmed texts, in document order.
 */
async function documentHeadings(page) {
    const texts = await page.locator(`${NOTES_DOCUMENT} h1`).allTextContents();
    return texts.map(text => text.trim());
}

/** The scripts and event handler attributes under an element.
 *
 * @param {import("playwright").Locator} locator - The element.
 * @returns {Promise<string[]>} - One line per script or attribute found.
 */
function scriptsAndHandlers(locator) {
    return locator.evaluate(element =>
        [...element.querySelectorAll("*")].flatMap(child => [
            ...(child.localName === "script" ? ["<script>"] : []),
            ...[...child.attributes]
                .filter(attribute => attribute.name.startsWith("on"))
                .map(attribute => `${child.localName} ${attribute.name}`)
        ])
    );
}

/** The font size of the notes document's text.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @returns {Promise<number>} - The size of its first paragraph, in pixels.
 */
function notesFontSize(page) {
    return page
        .locator(`${NOTES_DOCUMENT} p`)
        .first()
        .evaluate(element => parseFloat(getComputedStyle(element).fontSize), null, NOTES_WAIT);
}

Given(
    "the {string} deck is served over http with a notes file saying {string}",
    async function (fixture, text) {
        await this.serveDeck(fixture, `# One\n\n${text}\n`);
    }
);

When("the notes are scrolled to the section {string}", async function (title) {
    await sectionHeading(this.presenter, title).evaluate(
        element => element.scrollIntoView({block: "start"}),
        null,
        NOTES_WAIT
    );
});

When("the follow toggle is pressed", async function () {
    await this.presenter.getByRole("button", {name: "Follow", exact: true}).click(NOTES_WAIT);
});

When("the notes font size is increased", async function () {
    this.notesFontSize = await notesFontSize(this.presenter);
    await this.presenter.getByRole("button", {name: "A+", exact: true}).click(NOTES_WAIT);
});

When("the notes file is removed and the deck is rebuilt", function () {
    rebuildWithoutNotesFile(this.fixture);
});

Then("the notes title is {string}", async function (title) {
    await expect(this.presenter.locator(NOTES_TITLE_LINE)).toHaveText(title);
});

Then("the notes body shows {string} in bold", async function (text) {
    await expect(this.presenter.locator(`${NOTES_DOCUMENT} :is(b, strong)`)).toHaveText(text);
});

Then("the notes body links to {string}", async function (href) {
    await expect(this.presenter.locator(`${NOTES_DOCUMENT} a[href="${href}"]`)).toHaveCount(1);
});

Then("the notes body holds no script and no event handler attribute", async function () {
    const body = this.presenter.locator(NOTES_DOCUMENT);
    // The second frame's notes start with a paragraph; wait for it before looking.
    await expect(body).toContainText("Two");
    assert.deepEqual(await scriptsAndHandlers(body), []);
});

Then("the presenter page title is not {string}", async function (title) {
    // An image in the notes fires its error event once it has failed to load; wait for
    // every image to settle, then for a turn of the page, before reading the title.
    await this.presenter.waitForFunction(
        selector =>
            [...document.querySelectorAll(selector)].every(
                img => /** @type {HTMLImageElement} */ (img).complete
            ),
        `${NOTES_DOCUMENT} img`
    );
    await this.presenter.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
    assert.notEqual(await this.presenter.title(), title);
});

Then("the notes document has the headings {string}", async function (list) {
    const titles = list.split(",").map(title => title.trim());
    await expect.poll(() => documentHeadings(this.presenter)).toEqual(titles);
});

Then("the notes document shows a table, a task list and highlighted code", async function () {
    const notes = this.presenter.locator(NOTES_DOCUMENT);
    await expect(notes.locator("table").first()).toBeVisible(NOTES_WAIT);
    await expect(notes.locator('input[type="checkbox"]').first()).toBeVisible(NOTES_WAIT);
    await expect(notes.locator('pre code [class*="hljs-"]').first()).toBeVisible(NOTES_WAIT);
});

Then("the section {string} is at the top of the notes", async function (title) {
    const heading = sectionHeading(this.presenter, title);
    await expect(heading).toHaveCount(1, NOTES_WAIT);
    const distance = async () => Math.abs(await headingOffset(heading));
    await expect.poll(distance, NOTES_WAIT).toBeLessThanOrEqual(AT_TOP_TOLERANCE);
    // Still there a moment later: a smooth or late scroll has not carried it away.
    await this.presenter.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), SETTLE_MS);
    assert.ok((await distance()) <= AT_TOP_TOLERANCE, `the section "${title}" stays at the top`);
});

Then("the section {string} is marked as current", async function (title) {
    const marked = () =>
        this.presenter
            .locator(NOTES_DOCUMENT)
            .evaluate(notes =>
                [...notes.querySelectorAll("[aria-current]")].map(element =>
                    (element.matches("h1")
                        ? element
                        : element.querySelector("h1")
                    )?.textContent?.trim()
                )
            );
    await expect.poll(marked, NOTES_WAIT).toEqual([title]);
});

Then("the notes title line is hidden", async function () {
    // Hidden with visibility, so that the line keeps its place and the text does not shift.
    await expect(this.presenter.locator(NOTES_TITLE_LINE)).toHaveCSS(
        "visibility",
        "hidden",
        NOTES_WAIT
    );
});

Then("the notes title line shows {string}", async function (title) {
    const line = this.presenter.locator(NOTES_TITLE_LINE);
    await expect(line).toBeVisible(NOTES_WAIT);
    await expect(line).toHaveText(title, NOTES_WAIT);
});

Then("the notes font size is larger than the default", async function () {
    await expect
        .poll(() => notesFontSize(this.presenter), NOTES_WAIT)
        .toBeGreaterThan(this.notesFontSize);
});

Then("the notes document contains {string}", async function (text) {
    await expect(this.presenter.locator(NOTES_DOCUMENT)).toContainText(text, NOTES_WAIT);
});

Then("the notes document does not contain {string}", async function (text) {
    const notes = this.presenter.locator(NOTES_DOCUMENT);
    // The document is drawn first, so that an empty panel does not pass.
    await expect(notes.locator("h1").first()).toBeVisible(NOTES_WAIT);
    await expect(notes).not.toContainText(text, NOTES_WAIT);
});

Then("the notes document holds no script and no event handler attribute", async function () {
    assert.deepEqual(await scriptsAndHandlers(this.presenter.locator(NOTES_DOCUMENT)), []);
});
