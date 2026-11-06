/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {DisplayMirrorEvents} from "../DisplayMirror.js";
import {
    MINUTE_MS,
    TimerPhases,
    formatDuration,
    readTargetMinutes,
    remainingText,
    targetFieldText,
    timerPhase
} from "../clock.js";
import {TransportStatus} from "../../protocol/LocalTransport.js";
import {TimerActions, timerActionMessage, timerTargetMessage} from "../../protocol/timer.js";

/** @typedef {import("../DisplayMirror.js").DisplayMirror} DisplayMirror */
/** @typedef {import("../../protocol/messages.js").Message} Message */

/** How often the panel looks at the time, in milliseconds: often enough that a second on
 * screen is never late by a noticeable part of one.
 *
 * @readonly
 * @default
 * @type {number}
 */
const TICK_MS = 250;

/**
 * Give an element a text, if that is not the text it has: most ticks change nothing.
 *
 * @param {HTMLElement} element - The element.
 * @param {string} text - The text.
 */
function writeText(element, text) {
    if (element.textContent !== text) {
        element.textContent = text;
    }
}

/** The Clock panel: the time of day, the elapsed time largest of all, the frame, the timer's
 * controls and its target.
 *
 * The display owns the timer: a control sends a command, and what the panel shows always comes
 * from the mirror.
 */
export class ClockPanel {
    /** Draw the panel and follow the display and the time.
     *
     * @param {HTMLElement} element - The element the panel draws into.
     * @param {DisplayMirror} mirror - What the display last reported.
     * @param {(message: Message) => void} send - Sends a message to the audience window.
     * @param {any} host - The window, for its timers and its date.
     */
    constructor(element, mirror, send, host) {
        this.element = element;
        this.mirror = mirror;
        this.send = send;
        this.host = host;

        const doc = element.ownerDocument;
        this.doc = doc;

        /** A part of the panel that shows a text.
         *
         * @param {string} name - Its class.
         * @returns {HTMLElement} The part.
         */
        const part = name => {
            const span = doc.createElement("span");
            span.className = name;
            return span;
        };
        this.time = part("sozi-clock__time");
        this.frame = part("sozi-clock__frame");
        this.elapsed = part("sozi-clock__elapsed");
        this.elapsed.setAttribute("role", "timer");
        this.remaining = part("sozi-clock__remaining");

        /** A button of the panel.
         *
         * @param {() => string} action - The action it sends when pressed, one of `TimerActions`.
         * @returns {HTMLButtonElement} The button.
         */
        const button = action => {
            const b = doc.createElement("button");
            b.type = "button";
            b.addEventListener("click", () => send(timerActionMessage(action())));
            return b;
        };
        this.toggle = button(() =>
            mirror.timer.running ? TimerActions.pause : TimerActions.start
        );
        this.reset = button(() => TimerActions.reset);
        this.reset.textContent = "Reset";

        // Text, not a number field: a browser reports what it cannot read in one as empty,
        // and empty clears the target.
        this.field = doc.createElement("input");
        this.field.type = "text";
        this.field.setAttribute("inputmode", "decimal");
        this.field.addEventListener("change", () => this.commitTarget());
        const label = doc.createElement("label");
        label.className = "sozi-clock__target";
        label.append("Target (min)", this.field);

        const header = doc.createElement("div");
        header.className = "sozi-clock__header";
        header.append(this.time, this.frame);
        const controls = doc.createElement("div");
        controls.className = "sozi-clock__controls";
        controls.append(this.toggle, this.reset, label);
        const clock = doc.createElement("div");
        clock.className = "sozi-clock";
        clock.append(header, this.elapsed, this.remaining, controls);
        element.append(clock);

        this.onChange = () => this.show();
        mirror.on(DisplayMirrorEvents.change, this.onChange);
        this.interval = host.setInterval(() => this.show(), TICK_MS);
        this.show();
    }

    /** Show the time, the frame and the state of the controls as they are now. */
    show() {
        const {mirror} = this;
        const {running, targetMs} = mirror.timer;
        const elapsedMs = mirror.elapsedAt();
        const phase = timerPhase(elapsedMs, targetMs);

        writeText(
            this.time,
            new this.host.Date().toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})
        );
        writeText(this.frame, mirror.frame ? `${mirror.index + 1} / ${mirror.frameCount}` : "");
        writeText(this.elapsed, formatDuration(elapsedMs));
        writeText(this.remaining, remainingText(elapsedMs, targetMs));
        writeText(this.toggle, running ? "Pause" : "Start");
        this.elapsed.classList.toggle("sozi-clock__elapsed--near", phase === TimerPhases.near);
        this.elapsed.classList.toggle("sozi-clock__elapsed--over", phase === TimerPhases.over);

        const reachable = mirror.status === TransportStatus.connected;
        for (const control of [this.toggle, this.reset, this.field]) {
            control.disabled = !reachable;
        }
        // What the speaker is typing is not the display's to overwrite.
        if (this.doc.activeElement !== this.field) {
            this.field.value = targetFieldText(targetMs);
        }
    }

    /** Send the target in the field; text that is no target goes back to the target there is. */
    commitTarget() {
        const minutes = readTargetMinutes(this.field.value);
        if (minutes === undefined) {
            this.field.value = targetFieldText(this.mirror.timer.targetMs);
        } else {
            this.send(timerTargetMessage(minutes === null ? null : minutes * MINUTE_MS));
        }
    }

    /** Stop following the display and the time, and empty the element. */
    dispose() {
        this.host.clearInterval(this.interval);
        this.mirror.off(DisplayMirrorEvents.change, this.onChange);
        this.element.replaceChildren();
    }
}
