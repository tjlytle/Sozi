/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The presenter console: a surface of the presenter protocol (docs/presenter-protocol.md).
// It mirrors what the audience window reports in a workspace of panels the speaker
// arranges, and drives the audience window and the three previews.

import {LocalTransport, TransportStatus} from "./protocol/LocalTransport";
import {TransportSet} from "./protocol/TransportSet";
import {Roles, deckIdOf, helloMessage} from "./protocol/messages";
import {DisplayMirror, DisplayMirrorEvents} from "./presenter/DisplayMirror";
import {PresenterApi} from "./presenter/PresenterApi";
import {PresetForm} from "./presenter/PresetForm";
import {Workspace} from "./presenter/Workspace";
import {NARROW_MAX_WIDTH, layoutKey} from "./presenter/layout";
import {isEditableTarget, messageForKey} from "./presenter/keys";
import {PreviewPanel} from "./presenter/panels/PreviewPanel";
import {NotesPanel} from "./presenter/panels/NotesPanel";
import {ControlsPanel} from "./presenter/panels/ControlsPanel";
import {ConnectionPanel} from "./presenter/panels/ConnectionPanel";

/** @typedef {import("./protocol/messages").Message} Message */
/** @typedef {import("./presenter/panels").PanelDefinition} PanelDefinition */

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

/** Open the link to the audience window.
 *
 * @param {Window} audience - The audience window.
 * @param {TransportSet} transports - The links to the display.
 */
function connect(audience, transports) {
    const toAudience = new LocalTransport(window, audience);
    transports.add(toAudience);
    // A display that loaded before this page answers with its hello.
    toAudience.send(helloMessage(Roles.surface));
}

/** The six panels of the workspace, in the order the default layout adds them.
 *
 * @param {DisplayMirror} mirror - What the display last reported.
 * @param {(message: Message) => void} send - Sends a message to the audience window.
 * @param {string} src - The deck's page, for the previews.
 * @returns {PanelDefinition[]} The panels.
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
    return PANELS.map(({id, title, icon, ...defaults}) => ({
        id,
        title,
        icon,
        defaults,
        render: element => {
            const drawn = create(id, element);
            return () => drawn.dispose();
        }
    }));
}

/** Build the empty workspace, with the form that saves its layout as a preset.
 *
 * @param {HTMLElement} element - The workspace's element.
 * @returns {Workspace} The workspace.
 */
function buildWorkspace(element) {
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
        deckId: deckIdOf(encodeURIComponent(/** @type {string} */ (element.dataset.deck))),
        width: () => window.innerWidth,
        layout: () => workspace.layout,
        onSaved: showNotice
    });
    document.body.append(presetForm.element);
    return workspace;
}

/** Build the page when it has loaded: the audience window, the workspace and the keys.
 *
 * @param {object} options - What the module has built.
 * @param {PresenterApi} options.presenter - The published API.
 * @param {DisplayMirror} options.mirror - What the display last reported.
 * @param {TransportSet} options.transports - The links to the display.
 * @param {HTMLElement} options.element - The workspace's element.
 */
function startPresenter({presenter, mirror, transports, element}) {
    // Open a new window for the main presentation view.
    const audience = window.open(
        /** @type {string} */ (element.dataset.deck),
        "sozi-presentation",
        "width=600, height=400, scrollbars=yes, toolbar=yes"
    );
    // A blocked popup leaves audience null: the page says so and stays usable (standard 2.7).
    if (audience) {
        connect(audience, transports);
        audience.focus();
    } else {
        /** @type {HTMLElement} */ (document.querySelector(".sozi-notice")).hidden = false;
        mirror.setStatus(TransportStatus.closed);
    }

    mirror.on(DisplayMirrorEvents.change, ({viewport}) => {
        // Only the audience window's size shapes the previews.
        if (viewport) {
            document.documentElement.style.setProperty(
                "--sozi-display-aspect",
                String(viewport.width / viewport.height)
            );
        }
    });

    const workspace = buildWorkspace(element);
    // Before the mount: a transport an add-on registered can answer as soon as it is added.
    mirror.on(DisplayMirrorEvents.change, ({layouts}) => {
        if (layouts) {
            workspace.offerPresets(layouts);
        }
    });
    presenter.mount(workspace);
    workspace.open();

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
            transports.sendToPrimary(message);
            evt.stopPropagation();
            evt.preventDefault();
        }
    });
}

/** Publish `window.sozi` when the module loads, because custom scripts run before `load`.
 *
 * The built-in panels register first, so that they lead the queue and an add-on can name
 * one of them as its place.
 */
function publish() {
    const mirror = new DisplayMirror();
    const transports = new TransportSet();
    const presenter = new PresenterApi({mirror, transports});
    // Cast: the presenter page's `sozi` has this one member, unlike a deck's.
    window.sozi = /** @type {any} */ ({presenter});

    // Cast: the presenter page holds the workspace, with the deck's page on it.
    const element = /** @type {HTMLElement} */ (document.querySelector(".sozi-workspace"));
    const src = /** @type {string} */ (element.dataset.deck);
    const send = message => transports.sendToPrimary(message);
    for (const panel of panelSpecs(mirror, send, src)) {
        presenter.registerPanel(panel);
    }

    window.addEventListener(
        "load",
        () => startPresenter({presenter, mirror, transports, element}),
        false
    );
}

publish();
