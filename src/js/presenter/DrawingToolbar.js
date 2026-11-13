/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {DisplayMirrorEvents} from "./DisplayMirror.js";
import {
    PenTools,
    drawingClearMessage,
    drawingUndoMessage,
    drawingVisibleMessage
} from "../protocol/drawings.js";

/** @typedef {import("./DisplayMirror.js").DisplayMirror} DisplayMirror */
/** @typedef {import("./panels.js").PanelHandle} PanelHandle */
/** @typedef {import("../protocol/drawings.js").DrawingTool} DrawingTool */
/** @typedef {import("../protocol/messages.js").Message} Message */

/** The width of each tool, as a share of the preview's shorter side.
 *
 * @readonly
 * @type {Readonly<Record<string, number>>}
 */
export const TOOL_WIDTHS = Object.freeze({
    [PenTools.pen]: 0.004,
    [PenTools.highlighter]: 0.03,
    [PenTools.eraser]: 0.004
});

/** The tools, with their names on the toolbar.
 *
 * @readonly
 */
const TOOLS = Object.freeze([
    {tool: PenTools.pen, label: "Pen"},
    {tool: PenTools.highlighter, label: "Highlighter"},
    {tool: PenTools.eraser, label: "Eraser"}
]);

/** The colours, with their names; each swatch's look is the class that ends with its key.
 *
 * @readonly
 */
const COLORS = Object.freeze([
    {key: "red", label: "Red", color: "#e53935"},
    {key: "blue", label: "Blue", color: "#1e88e5"},
    {key: "green", label: "Green", color: "#43a047"},
    {key: "yellow", label: "Yellow", color: "#fdd835"}
]);

/** The toolbar of the current-frame preview: what the speaker draws with, and what changes the
 * drawings.
 *
 * It holds draw mode, the tool and the colour, and hands them on each time they change. `Draw`
 * turns draw mode on and off; the tool and colour buttons choose one each; `aria-pressed` says
 * which. Undo, Clear and Hide or Show send their messages to the display; Hide reads Show while
 * the display hides the drawings. Maximise, when the panel has a handle, reads Restore while a
 * panel fills the workspace. A press on the toolbar does not take the focus, so the talk's keys
 * keep working; a person can still Tab to a button.
 */
export class DrawingToolbar {
    /** Build the toolbar.
     *
     * @param {Document} doc - The page.
     * @param {object} options - What the toolbar follows and tells.
     * @param {DisplayMirror} options.mirror - What the display last reported.
     * @param {(message: Message) => void} options.send - Sends a message to the display.
     * @param {?PanelHandle} options.panel - The panel's handle, for Maximise; null for none.
     * @param {(tool: DrawingTool) => void} options.onTool - Called with what the pen draws with,
     *   each time it changes.
     */
    constructor(doc, {mirror, send, panel, onTool}) {
        this.doc = doc;
        this.mirror = mirror;
        this.panel = panel;
        this.onTool = onTool;

        /** Is draw mode on? A mouse or a finger then draws.
         *
         * @type {boolean}
         */
        this.draw = false;

        /** The tool chosen, one of `PenTools`.
         *
         * @type {string}
         */
        this.tool = PenTools.pen;

        /** The colour chosen, as `#rrggbb`.
         *
         * @type {string}
         */
        this.color = COLORS[0].color;

        this.element = doc.createElement("div");
        this.element.className = "sozi-drawing-toolbar";
        this.element.setAttribute("role", "toolbar");
        this.element.setAttribute("aria-label", "Drawing");
        // Keep the focus where it is, so the talk's keys keep moving the talk (#311).
        this.element.addEventListener("pointerdown", evt => evt.preventDefault());

        this.drawButton = this.button("Draw", () => this.choose({draw: !this.draw}));
        this.toolButtons = TOOLS.map(({tool, label}) =>
            this.button(label, () => this.choose({tool}))
        );
        this.colorButtons = COLORS.map(({key, label, color}) => {
            const swatch = this.button("", () => this.choose({color}), `--${key}`);
            swatch.setAttribute("aria-label", label);
            return swatch;
        });
        const undo = this.button("Undo", () => send(drawingUndoMessage()));
        this.visibleButton = this.button("", () =>
            send(drawingVisibleMessage(!mirror.drawings.visible))
        );
        const clear = this.button("Clear", () => send(drawingClearMessage()), "--clear");
        this.maximiseButton = panel ? this.button("", () => panel.maximise()) : null;

        this.element.append(
            this.group(this.drawButton, ...this.toolButtons),
            this.group(...this.colorButtons),
            this.group(undo, this.visibleButton, clear),
            ...(this.maximiseButton ? [this.group(this.maximiseButton)] : [])
        );

        this.onChange = ({drawings}) => {
            if (drawings !== undefined) {
                this.update();
            }
        };
        mirror.on(DisplayMirrorEvents.change, this.onChange);
        this.stopFollowingPanel = panel ? panel.onMaximisedChange(() => this.update()) : () => {};
        this.update();
    }

    /** What the pen draws with now.
     *
     * @readonly
     * @type {DrawingTool}
     */
    get state() {
        return {draw: this.draw, tool: this.tool, color: this.color, width: TOOL_WIDTHS[this.tool]};
    }

    /** A button of the toolbar.
     *
     * @param {string} text - Its text.
     * @param {() => void} onPress - What it does.
     * @param {string} [modifier] - The end of its modifier class, as `--clear`.
     * @returns {HTMLButtonElement} The button.
     */
    button(text, onPress, modifier) {
        const button = this.doc.createElement("button");
        button.type = "button";
        button.className = "sozi-drawing-toolbar__button";
        if (modifier) {
            button.className += ` sozi-drawing-toolbar__button${modifier}`;
        }
        button.textContent = text;
        button.addEventListener("click", onPress);
        return button;
    }

    /** A group of buttons, kept together when the toolbar wraps.
     *
     * @param {...HTMLButtonElement} buttons - The buttons.
     * @returns {HTMLElement} The group.
     */
    group(...buttons) {
        const group = this.doc.createElement("div");
        group.className = "sozi-drawing-toolbar__group";
        group.append(...buttons);
        return group;
    }

    /** Change the mode, the tool or the colour, and hand the result on.
     *
     * @param {{draw?: boolean, tool?: string, color?: string}} change - What changes.
     */
    choose({draw = this.draw, tool = this.tool, color = this.color}) {
        this.draw = draw;
        this.tool = tool;
        this.color = color;
        this.update();
        this.onTool(this.state);
    }

    /** Show what is chosen, and the labels that follow the display and the panel. */
    update() {
        this.drawButton.setAttribute("aria-pressed", String(this.draw));
        TOOLS.forEach(({tool}, i) =>
            this.toolButtons[i].setAttribute("aria-pressed", String(tool === this.tool))
        );
        COLORS.forEach(({color}, i) =>
            this.colorButtons[i].setAttribute("aria-pressed", String(color === this.color))
        );
        this.visibleButton.textContent = this.mirror.drawings.visible
            ? "Hide drawings"
            : "Show drawings";
        if (this.maximiseButton && this.panel) {
            this.maximiseButton.textContent = this.panel.maximised ? "Restore" : "Maximise";
        }
    }

    /** Stop following the display and the panel, and take the toolbar off the page. */
    dispose() {
        this.mirror.off(DisplayMirrorEvents.change, this.onChange);
        this.stopFollowingPanel();
        this.element.remove();
    }
}
