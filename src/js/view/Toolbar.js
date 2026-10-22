/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {h} from "inferno-hyperscript";
import {VirtualDOMView} from "./VirtualDOMView";
import screenfull from "screenfull";
import pkg from "../../../package.json";

/** Toolbar in the presentation editor.
 *
 * @extends VirtualDOMView
 * @todo Add documentation.
 */
export class Toolbar extends VirtualDOMView {
    /** Initialize a new toolbar view.
     *
     * @param {HTMLElement} container - The HTML element that will contain this preview area.
     * @param {module:view/Properties.Properties} properties - The properties view of the editor.
     * @param {module:model/Presentation.Presentation} presentation - The current Sozi presentation.
     * @param {module:player/Viewport.Viewport} viewport - The viewport where the presentation is displayed.
     * @param {module:Controller.Controller} controller - The controller that manages the current editor.
     */
    constructor(container, properties, presentation, viewport, controller) {
        super(container, controller);

        /** The properties view of the editor.
         *
         * @type {module:view/Properties.Properties}
         */
        this.properties = properties;

        /** The current Sozi presentation.
         *
         * @type {module:model/Presentation.Presentation}
         */
        this.presentation = presentation;

        /** The viewport where the presentation is displayed.
         *
         * @type {module:player/Viewport.Viewport}
         */
        this.viewport = viewport;

        screenfull.on("change", () => this.repaint());
        properties.on("modeChange", () => this.repaint());
    }

    /** @inheritdoc */
    render() {
        const properties = this.properties;
        const controller = this.controller;
        const _ = controller.gettext;

        this.state["aspect-width"] = {value: this.presentation.aspectWidth};
        this.state["aspect-height"] = {value: this.presentation.aspectHeight};

        return h("div", [
            h("span.sozi-toolbar__group", [
                _("Aspect ratio: "),
                h("input.sozi-toolbar__aspect", {
                    id: "field-aspect-width",
                    type: "number",
                    pattern: "\\d+",
                    min: "1",
                    step: "1",
                    size: "3",
                    onchange() {
                        const width = parseInt(this.value);
                        // @ts-expect-error Bug kept: a number has no isNaN property, so this test is always true.
                        if (!width.isNaN) {
                            controller.setAspectWidth(width);
                        }
                    }
                }),
                " : ",
                h("input.sozi-toolbar__aspect", {
                    id: "field-aspect-height",
                    type: "number",
                    pattern: "\\d+",
                    min: "1",
                    step: "1",
                    size: "3",
                    onchange() {
                        const height = parseInt(this.value);
                        // @ts-expect-error Bug kept: a number has no isNaN property, so this test is always true.
                        if (!height.isNaN) {
                            controller.setAspectHeight(height);
                        }
                    }
                })
            ]),
            h("span.sozi-toolbar__group.sozi-editor__button-group", [
                h(
                    "button",
                    {
                        title: _("Move the selected layers (hold Alt to zoom, Shift to rotate)"),
                        className:
                            this.viewport.dragMode === "translate"
                                ? "sozi-editor__button--active"
                                : "",
                        onclick() {
                            controller.setDragMode("translate");
                        }
                    },
                    h("i.fa.fa-arrows")
                ),
                h(
                    "button",
                    {
                        title: _(
                            "Zoom in/out on the selected layers (you can also hold the Alt key in Move mode)"
                        ),
                        className:
                            this.viewport.dragMode === "scale" ? "sozi-editor__button--active" : "",
                        onclick() {
                            controller.setDragMode("scale");
                        }
                    },
                    h("i.fa.fa-expand")
                ),
                h(
                    "button",
                    {
                        title: _(
                            "Rotate the selected layers (you can also hold the Shift key in Move mode)"
                        ),
                        className:
                            this.viewport.dragMode === "rotate"
                                ? "sozi-editor__button--active"
                                : "",
                        onclick() {
                            controller.setDragMode("rotate");
                        }
                    },
                    h("i.fa.fa-rotate-left")
                ),
                h(
                    "button",
                    {
                        title: _("Edit the clipping area"),
                        className:
                            this.viewport.dragMode === "clip" ? "sozi-editor__button--active" : "",
                        onclick() {
                            controller.setDragMode("clip");
                        }
                    },
                    h("i.fa.fa-crop")
                )
            ]),
            h("span.sozi-toolbar__group.sozi-editor__button-group", [
                h(
                    "button",
                    {
                        title: _("Undo"),
                        disabled: controller.undoStack.length ? undefined : "disabled",
                        onclick() {
                            controller.undo();
                        }
                    },
                    h("i.fa.fa-reply")
                ), // "reply" icon preferred to the official "undo" icon
                h(
                    "button",
                    {
                        title: _("Redo"),
                        disabled: controller.redoStack.length ? undefined : "disabled",
                        onclick() {
                            controller.redo();
                        }
                    },
                    h("i.fa.fa-share")
                ) // "share" icon preferred to the official "redo" icon
            ]),
            h("span.sozi-toolbar__group", [
                h(
                    "button",
                    {
                        title: screenfull.isFullscreen
                            ? _("Disable full-screen mode")
                            : _("Enable full-screen mode"),
                        id: "btn-fullscreen",
                        className: screenfull.isFullscreen
                            ? "sozi-editor__button--active"
                            : undefined,
                        disabled: !screenfull.isEnabled,
                        onclick() {
                            screenfull.toggle(document.documentElement);
                        }
                    },
                    h("i.fa.fa-desktop")
                )
            ]),
            h("span.sozi-toolbar__group.sozi-editor__button-group", [
                h(
                    "button",
                    {
                        title: _("Save the presentation"),
                        disabled:
                            controller.storage && controller.storage.htmlNeedsSaving
                                ? undefined
                                : "disabled",
                        onclick() {
                            controller.save();
                        }
                    },
                    h("i.fa.fa-download")
                ), // "download" icon preferred to the official "save" icon
                h(
                    "button",
                    {
                        title: _("Reload the SVG document"),
                        onclick() {
                            controller.reload();
                        }
                    },
                    h("i.fa.fa-refresh")
                ),
                // TODO disable the Export button if the feature is not available
                h(
                    "button",
                    {
                        title: _("Export the presentation"),
                        className:
                            properties.mode === "export"
                                ? "sozi-editor__button--active"
                                : undefined,
                        onclick() {
                            properties.toggleMode("export");
                        }
                    },
                    h("i.fa.fa-file")
                ) // "file-export" is missing in Fork-Awesome
            ]),
            h("span.sozi-toolbar__group.sozi-editor__button-group", [
                h(
                    "button",
                    {
                        title: _("Preferences"),
                        className:
                            properties.mode === "preferences"
                                ? "sozi-editor__button--active"
                                : undefined,
                        onclick() {
                            properties.toggleMode("preferences");
                        }
                    },
                    h("i.fa.fa-sliders")
                ),
                h(
                    "button",
                    {
                        title: _("Information"),
                        onclick() {
                            controller.hideNotification();
                            controller.info(`Sozi ${pkg.version}`, true);
                        }
                    },
                    h("i.fa.fa-info")
                )
            ])
        ]);
    }
}
