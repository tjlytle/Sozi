/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The presenter console: a surface of the presenter protocol (docs/presenter-protocol.md).
// It mirrors what the audience window reports in a workspace of panels the speaker
// arranges, and drives the audience window and the three previews.

import {LocalTransport, TransportEvents, TransportStatus} from "./protocol/LocalTransport";
import {Roles, deckIdOf, helloMessage, readMessage} from "./protocol/messages";
import {DisplayMirror, DisplayMirrorEvents} from "./presenter/DisplayMirror";
import {PresetForm} from "./presenter/PresetForm";
import {Workspace} from "./presenter/Workspace";
import {NARROW_MAX_WIDTH, layoutKey} from "./presenter/layout";
import {isEditableTarget, messageForKey} from "./presenter/keys";
import {PreviewPanel} from "./presenter/panels/PreviewPanel";
import {NotesPanel} from "./presenter/panels/NotesPanel";
import {ControlsPanel} from "./presenter/panels/ControlsPanel";
import {ConnectionPanel} from "./presenter/panels/ConnectionPanel";

/** @typedef {import("./protocol/messages").Message} Message */
/** @typedef {import("./presenter/Workspace").PanelSpec} PanelSpec */

/** The six panels, in the order the default layout adds them, and their place in it.
 *
 * Current over Controls over Previous and Next, on the left; Notes right, with Connection
 * as a tab behind it.
 *
 * @readonly
 */
const PANELS = Object.freeze([
    {id: "current", title: "Current", icon: "◉"},
    {
        id: "notes",
        title: "Notes",
        icon: "✎",
        position: {referencePanel: "current", direction: "right"}
    },
    {
        id: "connection",
        title: "Connection",
        icon: "⇄",
        position: {referencePanel: "notes", direction: "within"},
        inactive: true
    },
    {
        id: "controls",
        title: "Controls",
        icon: "⏯",
        position: {referencePanel: "current", direction: "below"},
        initialHeight: 96
    },
    {
        id: "previous",
        title: "Previous",
        icon: "◀",
        position: {referencePanel: "controls", direction: "below"}
    },
    {
        id: "next",
        title: "Next",
        icon: "▶",
        position: {referencePanel: "previous", direction: "right"}
    }
]);

/** The frame each preview shows, relative to the current one, by panel id.
 *
 * @readonly
 */
const PREVIEW_OFFSETS = Object.freeze({current: 0, previous: -1, next: 1});

/** The function that shows a text in the page's layout notice, until it is dismissed.
 *
 * @returns {(text: string) => void} The function.
 */
function layoutNotice() {
    const notice = /** @type {HTMLElement} */ (document.querySelector(".sozi-layout-notice"));
    const text = /** @type {HTMLElement} */ (notice.querySelector(".sozi-layout-notice__text"));
    const dismiss = /** @type {HTMLElement} */ (notice.querySelector("button"));
    dismiss.addEventListener("click", () => (notice.hidden = true));
    return message => {
        text.textContent = message;
        notice.hidden = false;
    };
}

/** Connect the mirror to the audience window.
 *
 * @param {Window} audience - The audience window.
 * @param {DisplayMirror} mirror - The mirror to keep up to date.
 * @returns {LocalTransport} The transport to the audience window.
 */
function connect(audience, mirror) {
    const toAudience = new LocalTransport(window, audience);
    toAudience.onMessage(data => {
        const message = readMessage(data);
        if (message) {
            mirror.apply(message);
        }
    });
    toAudience.on(TransportEvents.statusChange, status => mirror.setStatus(status));
    // A display that loaded before this page answers with its hello.
    toAudience.send(helloMessage(Roles.surface));
    return toAudience;
}

/** The six panels of the workspace, in the order the default layout adds them.
 *
 * @param {DisplayMirror} mirror - What the display last reported.
 * @param {(message: Message) => void} send - Sends a message to the audience window.
 * @param {string} src - The deck's page, for the previews.
 * @returns {PanelSpec[]} The panels.
 */
function panelSpecs(mirror, send, src) {
    /** Draw a panel into its element.
     *
     * @param {string} id - The panel's id.
     * @param {HTMLElement} element - Its element.
     * @returns {{dispose: () => void}} The panel.
     */
    const create = (id, element) => {
        switch (id) {
            case "notes":
                return new NotesPanel(element, mirror);
            case "connection":
                return new ConnectionPanel(element, mirror);
            case "controls":
                return new ControlsPanel(element, mirror, send);
            default: {
                const offset = PREVIEW_OFFSETS[id];
                return new PreviewPanel(element, mirror, send, {
                    offset,
                    className: `sozi-${id}-frame`,
                    src
                });
            }
        }
    };
    return PANELS.map(panel => ({
        ...panel,
        render: element => {
            const drawn = create(panel.id, element);
            return () => drawn.dispose();
        }
    }));
}

window.addEventListener(
    "load",
    () => {
        // Cast: the presenter page holds the workspace, with the deck's page on it.
        const element = /** @type {HTMLElement} */ (document.querySelector(".sozi-workspace"));
        const src = /** @type {string} */ (element.dataset.deck);
        const mirror = new DisplayMirror();

        // Open a new window for the main presentation view.
        const audience = window.open(
            src,
            "sozi-presentation",
            "width=600, height=400, scrollbars=yes, toolbar=yes"
        );
        // A blocked popup leaves audience null: the page says so and stays usable (standard 2.7).
        const toAudience = audience ? connect(audience, mirror) : null;
        if (audience) {
            audience.focus();
        } else {
            /** @type {HTMLElement} */ (document.querySelector(".sozi-notice")).hidden = false;
            mirror.setStatus(TransportStatus.closed);
        }
        const send = message => {
            if (toAudience) {
                toAudience.send(message);
            }
        };

        mirror.on(DisplayMirrorEvents.change, ({viewport}) => {
            // Only the audience window's size shapes the previews.
            if (viewport) {
                document.documentElement.style.setProperty(
                    "--sozi-display-aspect",
                    String(viewport.width / viewport.height)
                );
            }
        });

        const showNotice = layoutNotice();
        const workspace = new Workspace(element, {
            storage: window.localStorage,
            keys: {
                wide: layoutKey(location.pathname),
                narrow: layoutKey(location.pathname, true)
            },
            media: window.matchMedia(`(max-width: ${NARROW_MAX_WIDTH}px)`),
            onNotice: showNotice,
            onSavePreset: () => presetForm.open()
        });
        const presetForm = new PresetForm(document, window, {
            // The template names the deck's page as a file; deckIdOf reads an encoded path.
            deckId: deckIdOf(encodeURIComponent(src)),
            width: () => window.innerWidth,
            layout: () => workspace.layout,
            onSaved: showNotice
        });
        document.body.append(presetForm.element);
        for (const spec of panelSpecs(mirror, send, src)) {
            workspace.addPanel(spec);
        }
        workspace.open();
        mirror.on(DisplayMirrorEvents.change, ({layouts}) => {
            if (layouts) {
                workspace.offerPresets(layouts);
            }
        });

        window.addEventListener("keydown", evt => {
            if (isEditableTarget(evt.target)) {
                return;
            }
            const modifiers = {
                shift: evt.shiftKey,
                alt: evt.altKey,
                ctrl: evt.ctrlKey,
                meta: evt.metaKey
            };
            const message = messageForKey(evt.key, modifiers, mirror);
            if (message) {
                send(message);
                evt.stopPropagation();
                evt.preventDefault();
            }
        });
    },
    false
);
