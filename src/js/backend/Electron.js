/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {AbstractBackend, addBackend} from "./AbstractBackend";
import fs from "fs";
import path from "path";
import process from "process";
import Jed from "jed";
import screenfull from "screenfull";
import * as remote from "@electron/remote";
import settings from "electron-app-settings";
import {getCliOptions} from "../cli";

/** Type for Electron browser windows.
 *
 * @external BrowserWindow
 */

/** The main browser window of the Sozi editor.
 *
 * @type {BrowserWindow}
 */
const browserWindow = remote.getCurrentWindow();

/** The current working directory.
 *
 * We use the `PWD` environment variable directly because
 * `process.cwd()` returns the installation path of Sozi.
 *
 * @type {string}
 */
const cwd = process.env.PWD;

/** A Sozi editor backend based on Electron.
 *
 * @extends module:backend/AbstractBackend.AbstractBackend
 */
export class Electron extends AbstractBackend {

    /** Initialize a Sozi  backend based on Electron.
     *
     * @param {module:Controller.Controller} controller - A controller instance.
     * @param {HTMLElement} container - The element that will contain the menu for choosing a backend.
     */
    constructor(controller, container) {
        const _ = controller.gettext;

        super(controller, container, "sozi-editor-backend-Electron-input", _("Open an SVG file from your computer"));

        /** A dictionary of file watchers.
         *
         * Populated by the {@linkcode module:backend/Electron.Electron#load|load} method.
         *
         * @type {object.<string, fs.FSWatcher>}
         */
        this.watchers = {};

        // In command-line mode, the CLI runner opens the file and the
        // window is hidden: no window geometry, no close dialog, no file chooser.
        if (getCliOptions()) {
            return;
        }

        this.loadConfiguration();

        document.getElementById("sozi-editor-backend-Electron-input").addEventListener("click", () => this.openFileChooser());

        // Save files when closing the window
        let closing = false;

        window.addEventListener("beforeunload", async evt => {
            // Workaround for a bug in Electron where the window closes after a few
            // seconds even when calling dialog.showMessageBox() synchronously.
            if (closing) {
                return;
            }

            this.controller.removeAllListeners("blur");

            closing = true;
            evt.returnValue = false;

            if (this.hasOutdatedFiles && this.controller.getPreference("saveMode") !== "onblur") {
                // If autosave is disabled and some files are outdated, ask user confirmation.
                const res = await remote.dialog.showMessageBox(browserWindow, {
                    type: "question",
                    message: _("Do you want to save the presentation before closing?"),
                    buttons: [_("Yes"), _("No")],
                    defaultId: 0,
                    cancelId: 1
                });
                this.quit(res.response === 0);
            }
            else {
                window.setTimeout(() => this.quit(true));
            }
        });

        // If a file name was provided on the command line,
        // check that the file exists and load it.
        // Open a file chooser if no file name was provided or
        // the file does not exist.
        if (remote.process.argv.length > 1) {
            const arg = remote.process.argv[remote.process.argv.length - 1];
            const fileName = path.resolve(cwd, arg);
            if (fs.existsSync(fileName) && fs.statSync(fileName).isFile()) {
                // Open the file chooser if the file could not be opened, e.g. a presentation whose SVG file is missing.
                this.controller.storage.open(fileName, this).then(ok => {
                    if (process.env.SOZI_TEST_EXPORT) {
                        this.runTestExport(ok, process.env.SOZI_TEST_EXPORT);
                    }
                    else if (!ok) {
                        setTimeout(() => this.openFileChooser(), 100);
                    }
                });
            }
            else {
                this.controller.error(Jed.sprintf(_("File not found: %s."), fileName));
                // Force the error notification to appear before the file chooser.
                setTimeout(() => this.openFileChooser(), 100);
            }
        }
        else {
            this.openFileChooser();
        }
    }

    /** Test hook: export the opened presentation through the controller and exit.
     *
     * Only called when the environment variable `SOZI_TEST_EXPORT` is set
     * to `pdf`, `pptx` or `video`. The exit code is 0 if the export succeeded.
     * Nothing is saved on exit: no preferences, no window geometry.
     *
     * @param {boolean} opened - Was the presentation opened successfully?
     * @param {string} type - The export type.
     */
    async runTestExport(opened, type) {
        const method = {pdf: "exportToPDF", pptx: "exportToPPTX", video: "exportToVideo"}[type];
        let failure = opened ? null : "the presentation could not be opened";
        if (!method) {
            failure = `unknown SOZI_TEST_EXPORT type: ${type}`;
        }
        if (!failure) {
            const error = this.controller.error;
            this.controller.error = msg => {
                failure = msg;
                error.call(this.controller, msg);
            };
            await this.controller[method]();
            this.controller.error = error;
        }
        if (failure) {
            console.error(`SOZI_TEST_EXPORT failed: ${failure}`);
        }
        remote.app.exit(failure ? 1 : 0);
    }

    /** Close the editor window and terminate the application.
     *
     * @param {boolean} confirmSave - If `true`, save the current presentation before quitting.
     */
    async quit(confirmSave) {
        // Always save the window settings and the preferences.
        this.saveConfiguration();
        this.controller.preferences.save();

        if (confirmSave && this.hasOutdatedFiles) {
            // Close the window only when all files have been saved.
            await this.saveOutdatedFiles();
        }

        browserWindow.close();
    }

    /** @inheritdoc */
    openFileChooser() {
        const _ = this.controller.gettext;

        const files = remote.dialog.showOpenDialogSync({
            title: _("Choose an SVG or presentation file"),
            filters: [{name: _("SVG and presentation files"), extensions: ["svg", "json"]}],
            properties: ["openFile"]
        });
        this.controller.hideNotification();
        if (files) {
            // Reopen the file chooser if the file could not be opened, as for a file on the command line.
            this.controller.storage.open(files[0], this).then(ok => ok || setTimeout(() => this.openFileChooser(), 100));
        }
    }

    /** @inheritdoc */
    getName(fileDescriptor) {
        return path.basename(fileDescriptor);
    }

    /** @inheritdoc */
    getLocation(fileDescriptor) {
        return path.dirname(fileDescriptor);
    }

    /** @inheritdoc */
    find(name, location) {
        const fileName = path.join(location, name);
        return new Promise((resolve, reject) => {
            fs.access(fileName, err => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(fileName);
                }
            });
        });
    }

    /** @inheritdoc */
    load(fileDescriptor) {
        return new Promise((resolve, reject) => {
            fs.readFile(fileDescriptor, { encoding: "utf8" }, (err, data) => {
                if (err) {
                    reject(err);
                }
                else {
                    // Watch for changes in the loaded file.
                    // This includes a debouncing mechanism to ensure the file is in a stable
                    // state when the storage is notified.
                    // In command-line mode, files are read once: no watcher.
                    if (!getCliOptions() && !(fileDescriptor in this.watchers)) {
                        try {
                            const watcher = this.watchers[fileDescriptor] = fs.watch(fileDescriptor);
                            let timer;
                            watcher.on("change", () => {
                                if (timer) {
                                    clearTimeout(timer);
                                }
                                timer = setTimeout(() => {
                                    timer = 0;
                                    this.controller.onFileChange(fileDescriptor);
                                }, 100);
                            });
                        }
                        catch (err) {
                            const _ = this.controller.gettext;
                            this.controller.error(Jed.sprintf(_("This file will not be reloaded on change: %s."), fileDescriptor));
                        }
                    }
                    resolve(data);
                }
            });
        });
    }

    /** @inheritdoc */
    loadSync(fileDescriptor) {
        try {
            return fs.readFileSync(fileDescriptor, {encoding: "utf8" });
        }
        catch (e) {
            const _ = this.controller.gettext;
            this.controller.error(Jed.sprintf(_("Could not read file %s."), fileDescriptor));
            return "";
        }
    }

    /** @inheritdoc */
    create(name, location, mimeType, data) {
        const fileName = path.join(location, name);
        return new Promise((resolve, reject) => {
            // The directory is created if missing (an output directory).
            fs.mkdir(path.dirname(fileName), {recursive: true}, err => {
                if (err) {
                    reject(err);
                    return;
                }
                fs.writeFile(fileName, data, { encoding: "utf-8" }, err => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(fileName);
                    }
                });
            });
        });
    }

    /** @inheritdoc */
    save(fileDescriptor, data) {
        return new Promise((resolve, reject) => {
            fs.writeFile(fileDescriptor, data, { encoding: "utf-8" }, err => {
                if (err) {
                    reject(err);
                }
                else {
                    this.controller.storage.onSave(fileDescriptor);
                    resolve(fileDescriptor);
                }
            });
        });
    }

    /** Load the configuration of the current browser window.
     *
     * This method will restore the location, size, and fullscreen state
     * of the window.
     */
    loadConfiguration() {
        function getItem(key, val) {
            const result = localStorage.getItem(key);
            return result !== null ? JSON.parse(result) : val;
        }
        const [x, y] = browserWindow.getPosition();
        const [w, h] = browserWindow.getSize();
        browserWindow.setPosition(getItem("windowX", x), getItem("windowY", y));
        browserWindow.setSize(getItem("windowWidth", w), getItem("windowHeight", h));
        if (getItem("windowFullscreen", false)) {
            screenfull.request(document.documentElement);
        }
    }

    /** Save the configuration of the current browser window.
     *
     * This method will save the location, size, and fullscreen state
     * of the window.
     */
    saveConfiguration() {
        [localStorage.windowX, localStorage.windowY] = browserWindow.getPosition();
        [localStorage.windowWidth, localStorage.windowHeight] = browserWindow.getSize();
        localStorage.windowFullscreen = screenfull.isFullscreen;
    }

    /** @inheritdoc */
    toggleDevTools() {
        browserWindow.toggleDevTools();
    }

    /** @inheritdoc */
    getAppSetting(key) {
        return settings.get(key);
    }

    /** @inheritdoc */
    setAppSetting(key, newValue) {
        settings.set(key, newValue);
    }
}

addBackend(Electron);
