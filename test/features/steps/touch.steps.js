/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Steps for touch on the player page. Each one sends real touches through a CDP session
// (Input.dispatchTouchEvent), so Chromium hit-tests them as it would on a tablet.
// The distances and times are tuned to src/js/player/TouchGestures.js: a flick is the last
// move of at least 20 px within 200 ms of lifting the finger, a tap travels at most 10 px,
// a slow swipe travels half the window, and two fingers zoom once their distance has
// changed by more than 1.5 in squared length.

import {Given, When} from "@cucumber/cucumber";
import {setTimeout as sleep} from "node:timers/promises";

/** Where a one-finger gesture starts, on the slide. */
const CENTRE = {x: 640, y: 400};

/** The time between two moves of a slow gesture, about one display frame. */
const FRAME_MS = 16;

/** @typedef {{x: number, y: number}} Point */

/** Send one touch event to the deck page.
 *
 * @param {any} world - The scenario's world, holding the deck page and its CDP session.
 * @param {"touchStart"|"touchMove"|"touchEnd"} type - The event type.
 * @param {Point[]} points - Where the fingers touching the screen are; empty on touchEnd.
 */
async function touch(world, type, points) {
    if (!world.cdp) {
        world.cdp = await world.context.newCDPSession(world.deck);
    }
    await world.cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((p, id) => ({x: p.x, y: p.y, id}))
    });
}

/** Move the fingers from one place to another in even steps, then lift them.
 *
 * @param {any} world - The scenario's world.
 * @param {Point[]} from - Where each finger starts.
 * @param {Point[]} to - Where each finger ends.
 * @param {number} steps - How many moves the way is cut into.
 * @param {number} pauseMs - The time between two moves.
 */
async function gesture(world, from, to, steps, pauseMs) {
    await touch(world, "touchStart", from);
    for (let step = 1; step <= steps; step++) {
        if (pauseMs) {
            await sleep(pauseMs);
        }
        const points = from.map((p, i) => ({
            x: p.x + ((to[i].x - p.x) * step) / steps,
            y: p.y + ((to[i].y - p.y) * step) / steps
        }));
        await touch(world, "touchMove", points);
    }
    await touch(world, "touchEnd", []);
}

Given("the deck page is open on a touch screen", async function () {
    await this.openDeck(this.fixture, {touch: true});
});

When("a finger swipes left quickly", async function () {
    await gesture(this, [CENTRE], [{x: CENTRE.x - 150, y: CENTRE.y}], 3, 0);
});

When("a finger swipes right quickly", async function () {
    await gesture(this, [CENTRE], [{x: CENTRE.x + 150, y: CENTRE.y}], 3, 0);
});

When("a finger taps the slide", async function () {
    await touch(this, "touchStart", [CENTRE]);
    await touch(this, "touchEnd", []);
});

When("a finger drags slowly from the right edge to the left edge", async function () {
    const width = await this.deck.evaluate(() => window.innerWidth);
    // Steps of 10 px stay under the flick distance, so only the slow swipe can fire.
    const steps = Math.round((width - 20) / 10);
    await gesture(this, [{x: width - 10, y: CENTRE.y}], [{x: 10, y: CENTRE.y}], steps, FRAME_MS);
});

When("two fingers spread apart on the slide", async function () {
    await gesture(
        this,
        [
            {x: CENTRE.x - 40, y: CENTRE.y},
            {x: CENTRE.x + 40, y: CENTRE.y}
        ],
        [
            {x: CENTRE.x - 240, y: CENTRE.y},
            {x: CENTRE.x + 240, y: CENTRE.y}
        ],
        10,
        FRAME_MS
    );
});

When("two fingers move {int} pixels to the right", async function (distance) {
    const from = [
        {x: CENTRE.x - 100, y: CENTRE.y},
        {x: CENTRE.x + 100, y: CENTRE.y}
    ];
    await gesture(
        this,
        from,
        from.map(p => ({x: p.x + distance, y: p.y})),
        10,
        FRAME_MS
    );
});

When("a finger touches the slide for {int} milliseconds", async function (duration) {
    await touch(this, "touchStart", [CENTRE]);
    await sleep(duration);
    await touch(this, "touchEnd", []);
});
