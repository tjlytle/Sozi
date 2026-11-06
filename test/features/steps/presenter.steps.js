/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for the presenter page: opening it, moving the talk, reading what it shows.

import {Given, Then, When} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {expect} from "playwright/test";
import {builtDeck, rebuildWithoutNotesFile} from "../support/world.js";

// "Within a frame" in the plan: the previews have this long to take a new shape.
const WITHIN_A_FRAME = 250;

// What the Notes panel draws (#31): the document, with an h1 per section, and the title line.
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

/** What is wrong with the shape of the three previews, empty when nothing is.
 *
 * Each preview iframe must have the given width/height ratio within 1% and fit inside
 * the box that holds it.
 *
 * @param {import("playwright").Page} page - The presenter page.
 * @param {number} ratio - The expected width/height ratio.
 * @returns {Promise<string[]>} - One line per preview that is out of shape.
 */
function previewShapeProblems(page, ratio) {
    return page.evaluate(expected => {
        const problems = [];
        for (const iframe of document.querySelectorAll("iframe")) {
            const own = iframe.getBoundingClientRect();
            const box = /** @type {Element} */ (iframe.parentElement).getBoundingClientRect();
            const actual = own.width / own.height;
            const name = iframe.className;
            if (!(Math.abs(actual / expected - 1) <= 0.01)) {
                problems.push(`${name} is ${own.width}x${own.height}, ratio ${actual}`);
            }
            if (
                own.left < box.left - 1 ||
                own.top < box.top - 1 ||
                own.right > box.right + 1 ||
                own.bottom > box.bottom + 1
            ) {
                problems.push(`${name} overflows its ${box.width}x${box.height} box`);
            }
        }
        return problems;
    }, ratio);
}

Given("the {string} deck is built", function (fixture) {
    builtDeck(fixture);
    this.fixture = fixture;
});

Given("the presenter page is open", async function () {
    await this.openPresenter(this.fixture);
    await expect(this.presenter.locator(".sozi-current-index")).not.toBeEmpty();
});

Given("the presenter page is open without its audience window", async function () {
    // Cast: the Before hook opens a context for every scenario.
    const context = /** @type {import("playwright").BrowserContext} */ (this.context);
    // A stand-in for the audience window that never reports, so no viewport arrives.
    await context.addInitScript(() => {
        window.open = () => /** @type {any} */ ({focus() {}, postMessage() {}});
    });
    this.presenter = await context.newPage();
    await this.presenter.goto(pathToFileURL(builtDeck(this.fixture).presenter).href);
});

Given("the presenter page is open with pop-ups blocked", async function () {
    // Cast: the Before hook opens a context for every scenario.
    const context = /** @type {import("playwright").BrowserContext} */ (this.context);
    // A blocked pop-up: the browser's window.open returns null.
    await context.addInitScript(() => {
        window.open = () => null;
    });
    this.presenter = await context.newPage();
    await this.presenter.goto(pathToFileURL(builtDeck(this.fixture).presenter).href);
});

When("the audience window is resized to {int} by {int}", async function (width, height) {
    await this.audience.setViewportSize({width, height});
});

When("the presenter page is resized to {int} by {int}", async function (width, height) {
    await this.presenter.setViewportSize({width, height});
});

When("the presenter page is reloaded", async function () {
    await this.presenter.reload();
    await expect(this.presenter.locator(".sozi-current-index")).not.toBeEmpty();
});

When("the next button is pressed", async function () {
    await this.presenter.locator("#sozi-next-btn").click();
});

When("the previous button is pressed", async function () {
    await this.presenter.locator("#sozi-previous-btn").click();
});

When("the key {string} is pressed on the presenter page", async function (key) {
    await this.presenter.keyboard.press(key);
});

When("the audience transition has finished", async function () {
    // Let the audience window handle any message already posted to it before looking.
    await this.audience.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
    await expect
        .poll(() => this.audience.evaluate(() => window.sozi.player.animator.running))
        .toBe(false);
});

When("the presenter page posts itself a frame change to index {int}", async function (index) {
    // A frameChange with the protocol's fields, but from the presenter page, not the display.
    await this.presenter.evaluate(i => {
        window.postMessage({name: "frameChange", index: i, id: "", title: "Two", notes: ""}, "*");
        // Give the page a turn to handle it before the next step looks.
        return new Promise(resolve => setTimeout(resolve, 50));
    }, index);
});

Then("the frame counter reads {string}", async function (text) {
    const [index, length] = text.split("/").map(s => s.trim());
    await expect(this.presenter.locator(".sozi-current-index")).toHaveText(index);
    await expect(this.presenter.locator(".sozi-presentation-length")).toHaveText(length);
});

Then("the notes title is {string}", async function (title) {
    await expect(this.presenter.locator(".sozi-notes-title")).toHaveText(title);
});

Then("the audience window is on frame {string}", async function (title) {
    await expect
        .poll(() => this.audience.evaluate(() => window.sozi.player.currentFrame.title))
        .toBe(title);
    assert.ok(this.audience, "the audience window is open");
});

Then("the audience window is blank", async function () {
    await expect
        .poll(() => this.audience.evaluate(() => window.sozi.player.blankScreenIsVisible))
        .toBe(true);
});

Then("the audience window is not blank", async function () {
    await expect
        .poll(() => this.audience.evaluate(() => window.sozi.player.blankScreenIsVisible))
        .toBe(false);
});

Then("every preview has the audience window's shape", async function () {
    const ratio = await this.audience.evaluate(() => window.innerWidth / window.innerHeight);
    await expect
        .poll(() => previewShapeProblems(this.presenter, ratio), {timeout: WITHIN_A_FRAME})
        .toEqual([]);
});

Then("every preview has the shape {int}:{int}", async function (width, height) {
    await expect
        .poll(() => previewShapeProblems(this.presenter, width / height), {
            timeout: WITHIN_A_FRAME
        })
        .toEqual([]);
});

// The notes body, for the formatted-notes scenarios (src/templates/presenter.html).

Then("the notes body shows {string} in bold", async function (text) {
    await expect(this.presenter.locator(".sozi-notes-body :is(b, strong)")).toHaveText(text);
});

Then("the notes body links to {string}", async function (href) {
    await expect(this.presenter.locator(`.sozi-notes-body a[href="${href}"]`)).toHaveCount(1);
});

Then("the notes body holds no script and no event handler attribute", async function () {
    const body = this.presenter.locator(".sozi-notes-body");
    // The second frame's notes start with a paragraph; wait for it before looking.
    await expect(body).toContainText("Two");
    assert.deepEqual(await scriptsAndHandlers(body), []);
});

Then("the presenter page title is not {string}", async function (title) {
    // An image in the notes fires its error event once it has failed to load; wait for
    // every image to settle, then for a turn of the page, before reading the title.
    await this.presenter.waitForFunction(() =>
        [...document.querySelectorAll(".sozi-notes-body img")].every(
            img => /** @type {HTMLImageElement} */ (img).complete
        )
    );
    await this.presenter.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
    assert.notEqual(await this.presenter.title(), title);
});

Then("the presenter page shows the notice {string}", async function (text) {
    const notice = this.presenter.locator(".sozi-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(text);
});

Then("the presenter page shows no notice", async function () {
    // The notice is in the page but hidden, so a page without one does not pass.
    const notice = this.presenter.locator(".sozi-notice");
    await expect(notice).toHaveCount(1);
    await expect(notice).toBeHidden();
});

Then("no dialog was shown", function () {
    assert.deepEqual(this.dialogs, []);
});

// The notes as one document (#31). The controls are found as a person finds them, by the
// name on the button; the marker is `aria-current` on a section's heading or on an element
// that holds it.

Given(
    "the {string} deck is served over http with a notes file saying {string}",
    async function (fixture, text) {
        await this.serveDeck(fixture, `# One\n\n${text}\n`);
    }
);

Given("the {string} deck is served over http", async function (fixture) {
    await this.serveDeck(fixture);
});

When("the presenter page is opened from the server", async function () {
    await this.openPresenterAt(this.served.presenter);
    await expect(this.presenter.locator(".sozi-current-index")).not.toBeEmpty();
});

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
