/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The presenter console: a surface of the presenter protocol (docs/presenter-protocol.md).
// It mirrors what the audience window reports and drives it and the three previews.

import {LocalTransport} from "./protocol/LocalTransport";
import {
    MessageNames,
    Roles,
    helloMessage,
    blankMessage,
    jumpToFrameMessage,
    nextMessage,
    previousMessage,
    previewMessage,
    followLinkMessage,
    readMessage
} from "./protocol/messages";

/** The frame each preview iframe shows, relative to the current one, in page order.
 *
 * @readonly
 */
const PREVIEW_OFFSETS = Object.freeze([0, -1, 1]);

/** Set the text of the presenter page's element that matches a selector.
 *
 * @param {string} selector - The element's selector.
 * @param {string} text - Its new text.
 */
function setText(selector, text) {
    // Cast: the presenter page holds the elements this file names.
    /** @type {Element} */ (document.querySelector(selector)).textContent = text;
}

/** Connect the presenter page to the audience window and the previews.
 *
 * @param {Window} audience - The audience window.
 * @param {Window[]} frames - The windows of the preview iframes, in page order.
 */
function connect(audience, frames) {
    // The display as it last reported itself: the presenter holds no other frame state.
    const display = {frameCount: 0, index: 0, blank: false};
    const toAudience = new LocalTransport(window, audience);
    const previews = frames.map((frame, i) => ({
        offset: PREVIEW_OFFSETS[i],
        current: PREVIEW_OFFSETS[i] === 0,
        transport: new LocalTransport(window, frame),
        ready: false
    }));

    const updatePreview = p => {
        const index = display.index + p.offset;
        if (p.ready) {
            p.transport.send(
                index >= 0 && index < display.frameCount
                    ? jumpToFrameMessage(index, false)
                    : blankMessage(true)
            );
        }
    };

    const showFrame = ({index, title, notes}) => {
        display.index = index;
        setText(".sozi-current-index", String(index + 1));
        setText(".sozi-presentation-length", String(display.frameCount));
        setText(".sozi-notes-title", title);
        /** @type {Element} */ (document.querySelector(".sozi-notes-body")).innerHTML = notes;
        previews.forEach(updatePreview);
    };

    const showViewport = viewport => {
        // Only the audience window's size shapes the previews.
        document.documentElement.style.setProperty(
            "--sozi-display-aspect",
            String(viewport.width / viewport.height)
        );
    };

    // What each message from the audience window does, by name (standard 2.5).
    const fromAudience = {
        [MessageNames.hello]: message => {
            if (message.role === Roles.display) {
                display.frameCount = message.frameCount;
                display.blank = message.blank;
                if (message.viewport) {
                    showViewport(message.viewport);
                }
                showFrame(message.frame);
            }
        },
        [MessageNames.frameChange]: showFrame,
        [MessageNames.viewport]: showViewport,
        [MessageNames.blank]: ({on}) => {
            display.blank = on;
        }
    };
    toAudience.onMessage(data => {
        const message = readMessage(data);
        if (message && Object.hasOwn(fromAudience, message.name)) {
            fromAudience[message.name](message);
        }
    });

    for (const p of previews) {
        p.transport.onMessage(data => {
            const message = readMessage(data);
            if (!message) {
                return;
            }
            if (message.name === MessageNames.hello && message.role === Roles.display) {
                // A preview is a display too: it becomes a preview once it says hello.
                p.ready = true;
                p.transport.send(previewMessage(p.current));
                updatePreview(p);
            } else if (message.name === MessageNames.followLink && p.current) {
                toAudience.send(followLinkMessage(message.id));
            }
        });
    }

    // A display that loaded before this page answers with its hello.
    toAudience.send(helloMessage(Roles.surface));
    previews.forEach(p => p.transport.send(helloMessage(Roles.surface)));

    /** @type {HTMLElement} */ (document.getElementById("sozi-previous-btn")).addEventListener(
        "click",
        () => toAudience.send(previousMessage()),
        false
    );
    /** @type {HTMLElement} */ (document.getElementById("sozi-next-btn")).addEventListener(
        "click",
        () => toAudience.send(nextMessage()),
        false
    );

    const messageForKey = evt => {
        switch (evt.key) {
            case "Home":
                return jumpToFrameMessage(0, !evt.shiftKey);
            case "End":
                return jumpToFrameMessage(Math.max(display.frameCount - 1, 0), !evt.shiftKey);
            case "ArrowUp":
            case "PageUp":
            case "ArrowLeft":
                return previousMessage(!evt.shiftKey);
            case "ArrowDown":
            case "PageDown":
            case "ArrowRight":
            case "Enter":
            case " ":
                return nextMessage(!evt.shiftKey);
            case ".":
                return blankMessage(!display.blank);
            default:
                return null;
        }
    };

    window.addEventListener("keydown", evt => {
        // Keys with Alt/Ctrl/Meta modifiers are ignored
        const message = evt.altKey || evt.ctrlKey || evt.metaKey ? null : messageForKey(evt);
        if (message) {
            toAudience.send(message);
            evt.stopPropagation();
            evt.preventDefault();
        }
    });
}

window.addEventListener(
    "load",
    () => {
        const iframes = document.querySelectorAll("iframe");

        // Prevent the notes pane to change size when its content is updated.
        // Casts: the presenter page holds these elements.
        const preview = /** @type {HTMLElement} */ (document.querySelector(".sozi-frame-preview"));
        const notes = /** @type {HTMLElement} */ (document.querySelector(".sozi-notes"));
        new ResizeObserver(() => {
            notes.style.width = `calc(100vw - ${preview.offsetWidth}px`;
        }).observe(preview);

        // Open a new window for the main presentation view.
        const presWindow = window.open(
            iframes[0].src,
            "sozi-presentation",
            "width=600, height=400, scrollbars=yes, toolbar=yes"
        );
        try {
            // @ts-expect-error A blocked popup leaves presWindow null; the throw lands in the catch below.
            presWindow.focus();

            const frames = Array.from(
                iframes,
                iframe => /** @type {Window} */ (iframe.contentWindow)
            );
            // Cast: focus has not thrown, so the popup is open.
            connect(/** @type {Window} */ (presWindow), frames);
        } catch {
            alert(
                "Could not open presentation window. Please allow popups for this site and refresh this page."
            );
        }
    },
    false
);
