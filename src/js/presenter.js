/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The presenter console: a surface of the presenter protocol (docs/presenter-protocol.md).
// It mirrors what the audience window reports in a workspace of panels the speaker
// arranges, and drives the audience window and the three previews. The same page, built as
// the hosted shell, opens no audience window and joins a talk from a pairing link instead.

import {LocalTransport, TransportStatus} from "./protocol/LocalTransport";
import {TransportSet} from "./protocol/TransportSet";
import {Roles, deckIdOf, helloMessage} from "./protocol/hello";
import {isEditableTarget} from "./protocol/editable";
import {DisplayMirror, DisplayMirrorEvents} from "./presenter/DisplayMirror";
import {PresenterApi} from "./presenter/PresenterApi";
import {PresetForm} from "./presenter/PresetForm";
import {ShellJoin} from "./presenter/ShellJoin";
import {Workspace} from "./presenter/Workspace";
import {NARROW_MAX_WIDTH, layoutKey} from "./presenter/layout";
import {messageForKey} from "./presenter/keys";
import {PreviewPanel} from "./presenter/panels/PreviewPanel";
import {NotesPanel} from "./presenter/panels/NotesPanel";
import {ControlsPanel} from "./presenter/panels/ControlsPanel";
import {ClockPanel} from "./presenter/panels/ClockPanel";
import {ConnectionPanel} from "./presenter/panels/ConnectionPanel";
import {FramePickerPanel} from "./presenter/panels/FramePickerPanel";
import {ThumbnailCache} from "./presenter/ThumbnailCache";
import {ThumbnailSource} from "./presenter/ThumbnailSource";

/** @typedef {import("./protocol/messages").Message} Message */
/** @typedef {import("./presenter/panels").PanelDefinition} PanelDefinition */

/** The width of a thumbnail in the Frames panel, in pixels: a tile's width on a sharp phone.
 *
 * @readonly
 * @default
 * @type {number}
 */
const THUMBNAIL_WIDTH = 320;

/** The eight panels, in the order the default layout adds them, their place in it, and the
 * line the + menu shows under each title.
 *
 * Current over Controls over Previous and Next, on the left; Notes right, with Frames and
 * Connection as tabs behind it, over Clock.
 *
 * @readonly
 */
const PANELS = Object.freeze([
    {id: "current", title: "Current", icon: "◉", description: "The frame the audience sees"},
    {
        id: "notes",
        title: "Notes",
        icon: "✎",
        description: "The notes of the current frame",
        position: {referencePanel: "current", direction: "right"}
    },
    {
        id: "frames",
        title: "Frames",
        icon: "▦",
        description: "Every frame, to go to any of them",
        position: {referencePanel: "notes", direction: "within"},
        inactive: true
    },
    {
        id: "connection",
        title: "Connection",
        icon: "⇄",
        description: "The link to the audience window",
        position: {referencePanel: "notes", direction: "within"},
        inactive: true
    },
    {
        id: "clock",
        title: "Clock",
        icon: "◷",
        description: "The time of day and the talk timer",
        position: {referencePanel: "notes", direction: "below"}
    },
    {
        id: "controls",
        title: "Controls",
        icon: "⏯",
        description: "Previous, next, the frame counter and the blank screen",
        position: {referencePanel: "current", direction: "below"},
        initialHeight: 96
    },
    {
        id: "previous",
        title: "Previous",
        icon: "◀",
        description: "The frame before this one",
        position: {referencePanel: "controls", direction: "below"}
    },
    {
        id: "next",
        title: "Next",
        icon: "▶",
        description: "The frame after this one",
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

/** Open the audience window, or find the one this page opened before the speaker came back.
 *
 * Returning to this page, by any route, must leave the talk where it is: opening the deck's
 * address in a window that is on `#frame6` would restart it. So this asks for the window by
 * name alone, and sends it to the deck only if it comes back empty: it is new, or it was
 * closed. The name holds the deck's address, because a deck on `file:` cannot be asked which
 * deck it is: another deck's presenter page in this tab gets its own window.
 *
 * @param {string} src - The deck's page.
 * @returns {?Window} The audience window, null if the popup was blocked.
 */
function openAudience(src) {
    const name = `sozi-presentation ${new URL(src, window.location.href).href}`;
    const features = "width=600, height=400, scrollbars=yes, toolbar=yes";
    const found = window.open("", name, features);
    if (found && isEmptyWindow(found)) {
        found.location.href = src;
    }
    return found;
}

/** Is a window still on its first empty page?
 *
 * @param {Window} target - The window.
 * @returns {boolean} False for a window on a deck, including one the browser will not let
 *     this page read: decks on `file:` have opaque origins.
 */
function isEmptyWindow(target) {
    try {
        return target.location.href === "about:blank";
    } catch {
        return false;
    }
}

/** The Frames panel, with the thumbnails behind it.
 *
 * @param {HTMLElement} element - The panel's element.
 * @param {PresenterApi} presenter - The published API, as an add-on's panel would use it.
 * @param {string} src - The deck's page, which renders the thumbnails.
 * @returns {FramePickerPanel} The panel.
 */
function framePicker(element, presenter, src) {
    const thumbnails = new ThumbnailSource({
        cache: new ThumbnailCache(window.indexedDB),
        doc: document,
        src,
        pageVersion: document.lastModified,
        width: THUMBNAIL_WIDTH,
        createTransport: target => new LocalTransport(window, target)
    });
    return new FramePickerPanel(element, presenter, thumbnails);
}

/** The eight panels of the workspace, in the order the default layout adds them.
 *
 * @param {PresenterApi} presenter - The published API.
 * @param {DisplayMirror} mirror - What the display last reported.
 * @param {(message: Message) => void} send - Sends a message to the audience window.
 * @param {() => string} src - The deck's page, for the panels that load it, as it is when a
 *     panel is drawn: the hosted shell learns it on load, and a restored panel is drawn again.
 * @returns {PanelDefinition[]} The panels.
 */
function panelSpecs(presenter, mirror, send, src) {
    /** Draw a panel into its element.
     *
     * @param {string} id - The panel's id.
     * @param {HTMLElement} element - Its element.
     * @returns {{dispose: () => void}} The panel.
     */
    const create = (id, element) => {
        switch (id) {
            case "notes":
                return new NotesPanel(element, mirror, {
                    storage: window.localStorage,
                    deckHref: () => new URL(src(), location.href).href,
                    jumpToFrame: (index, transition) =>
                        presenter.display.jumpToFrame(index, transition)
                });
            case "frames":
                return framePicker(element, presenter, src());
            case "connection":
                return new ConnectionPanel(element, mirror);
            case "clock":
                return new ClockPanel(element, mirror, send, window);
            case "controls":
                return new ControlsPanel(element, mirror, send);
            default: {
                const offset = PREVIEW_OFFSETS[id];
                return new PreviewPanel(element, mirror, send, {
                    offset,
                    className: `sozi-${id}-frame`,
                    src: src()
                });
            }
        }
    };
    return PANELS.map(({id, title, icon, description, ...defaults}) => ({
        id,
        title,
        icon,
        description,
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
 * @param {string} deckId - The deck's id, for the presets.
 * @returns {Workspace} The workspace.
 */
function buildWorkspace(element, deckId) {
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
        deckId,
        width: () => window.innerWidth,
        layout: () => workspace.layout,
        onSaved: showNotice
    });
    document.body.append(presetForm.element);
    return workspace;
}

/** Join the display on the local page: open the audience window and link to it.
 *
 * @param {object} options - What the module has built.
 * @param {DisplayMirror} options.mirror - What the display last reported.
 * @param {TransportSet} options.transports - The links to the display.
 * @param {HTMLElement} options.element - The workspace's element.
 */
function joinAudience({mirror, transports, element}) {
    // Open a new window for the main presentation view.
    const audience = openAudience(/** @type {string} */ (element.dataset.deck));
    // A blocked popup leaves audience null: the page says so and stays usable (standard 2.7).
    if (audience) {
        connect(audience, transports);
        audience.focus();
    } else {
        /** @type {HTMLElement} */ (document.querySelector(".sozi-notice")).hidden = false;
        mirror.setStatus(TransportStatus.closed);
    }
}

/** The deck's id, for the presets.
 *
 * @param {PresenterApi} presenter - The published API, with the hosted shell's link on it.
 * @param {HTMLElement} element - The workspace's element.
 * @returns {string} The id.
 */
function deckIdOfPage({link}, element) {
    // The template names the deck's page as a file; deckIdOf reads an encoded path.
    return link
        ? deckIdOf(new URL(link.deck).pathname)
        : deckIdOf(encodeURIComponent(/** @type {string} */ (element.dataset.deck)));
}

/** Build the page when it has loaded: the link to the display, the workspace and the keys.
 *
 * @param {object} options - What the module has built.
 * @param {PresenterApi} options.presenter - The published API.
 * @param {DisplayMirror} options.mirror - What the display last reported.
 * @param {TransportSet} options.transports - The links to the display.
 * @param {HTMLElement} options.element - The workspace's element.
 */
function startPresenter({presenter, mirror, transports, element}) {
    if (document.querySelector('meta[name="sozi-presenter"][content="shell"]')) {
        // No transport yet: an add-on brings it, so the display cannot be reached until then.
        mirror.setStatus(TransportStatus.closed);
        new ShellJoin({api: presenter, document, window}).start();
    } else {
        joinAudience({mirror, transports, element});
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

    const workspace = buildWorkspace(element, deckIdOfPage(presenter, element));
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
    const src = () => /** @type {string} */ (element.dataset.deck);
    const send = message => transports.sendToPrimary(message);
    for (const panel of panelSpecs(presenter, mirror, send, src)) {
        presenter.registerPanel(panel);
    }

    window.addEventListener(
        "load",
        () => startPresenter({presenter, mirror, transports, element}),
        false
    );
}

publish();
