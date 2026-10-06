/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {SVGDocumentWrapper} from "./svg/SVGDocumentWrapper";
import {backendList} from "./backend/AbstractBackend";
import nunjucks from "nunjucks";
import Jed from "jed";
import {upgradeFromSVG, upgradeFromStorable} from "./upgrade";
import path from "path";
import {isPresentationFile, presentationDataError, presentationFiles, svgKeyOf, svgOfPresentation} from "./naming";
import {rewriteRelativeHrefs} from "./hrefs";

/** File read/write manager. */
export class Storage {
    /** Initialize a storage manager for a presentation.
     *
     * @param {module:Controller.Controller} controller - The controller that manages the current editor.
     * @param {module:model/Presentation.Presentation} presentation - The Sozi presentation opened in the editor.
     * @param {module:model/Selection.Selection} selection - The object that represents the selection in the timeline.
     */
    constructor(controller, presentation, selection) {
        /** The controller that manages the current editor.
         *
         * @type {module:Controller.Controller}
         */
        this.controller = controller;

        /** The current SVG document.
         *
         * @default
         * @type {module:svg/SVGDocumentWrapper.SVGDocumentWrapper}
         */
        this.document = null;

        /** The Sozi presentation opened in the editor.
         *
         * @type {module:model/Presentation.Presentation}
         */
        this.presentation = presentation;

        /** The object that represents the selection in the timeline.
         *
         * @type {module:model/Selection.Selection}
         */
        this.selection = selection;

        /** The current execution platform backend.
         *
         * @type {module:backend/AbstractBackend.AbstractBackend}
         */
        this.backend = null;

        /** The descriptor of the current SVG document file.
         *
         * @default
         * @type {any}
         */
        this.svgFileDescriptor  = null;

        /** The presentation file, when it is not the default one for the SVG file.
         *
         * Set by {@linkcode module:Storage.Storage#openPresentationFile|openPresentationFile}
         * and {@linkcode module:Storage.Storage#setSVGFile|setSVGFile}.
         *
         * @default
         * @type {?{name: string, location: any}}
         */
        this.presentationFile = null;

        /** The descriptor of the presentation HTML file.
         *
         * @default
         * @type {any}
         */
        this.htmlFileDescriptor = null;

        /** The descriptor of the presentation JSON file.
         *
         * @default
         * @type {any}
         */
        this.jsonFileDescriptor = null;

        /** Do we need to update the presentation JSON file?
         *
         * This property is true when the {@linkcode module:Controller.presentationChange|presentationChange}
         * or the {@linkcode module:Controller.editorStateChange|editorStateChange} event is detected.
         *
         * @default
         * @type {boolean}
         */
        this.jsonNeedsSaving = false;

        /** Do we need to update the presentation HTML file?
         *
         * This property is true when the {@linkcode module:Controller.presentationChange|presentationChange} event is detected.
         *
         * @default
         * @type {boolean}
         */
        this.htmlNeedsSaving = false;

        /** Create or update the JSON and HTML files when a presentation is opened?
         *
         * The command-line mode sets it to `false` so that opening a
         * presentation writes nothing.
         *
         * @default
         * @type {boolean}
         */
        this.writeOnOpen = true;

        /** The backend instances created by {@linkcode module:Storage.Storage#activate|activate}.
         *
         * @type {module:backend/AbstractBackend.AbstractBackend[]}
         */
        this.backends = [];

        /** The error raised when an existing JSON file could not be loaded.
         *
         * Set by {@linkcode module:Storage.Storage#openJSONFile|openJSONFile};
         * `null` if the file was loaded or did not exist.
         *
         * @default
         * @type {?Error}
         */
        this.jsonLoadError = null;

        // Adjust the template path depending on the target platform.
        // In the web browser, __dirname is set to "/src/js". The leading "/" will result
        // in an incorrect URL if the app is not hosted at the root of its domain.
        console.log(`__dirname=${__dirname}`);
        const templatePath = __dirname === "/build/browser/src/js" ? "/src/templates" : path.join(__dirname, "..", "templates");

        nunjucks.configure(templatePath, {
            watch: false,
            autoescape: false
        });

        controller.on("presentationChange", () => {
            this.jsonNeedsSaving = this.htmlNeedsSaving = true;
        });

        controller.on("editorStateChange",  () => {
            this.jsonNeedsSaving = true;
        });

        controller.on("blur", () => {
            if (this.backend && controller.getPreference("saveMode") === "onblur") {
                this.backend.doAutosave();
            }
        });
    }

    /** Finalize the initialization of the application.
     *
     * Show a load button for each supported {@link module:backend/AbstractBackend.AbstractBackend|backend} in the preview area.
     * Create an instance of each supported backend.
     */
    activate() {
        for (let backend of backendList) {
            const listItem = document.createElement("li");
            document.querySelector("#sozi-editor-view-preview ul").appendChild(listItem);

            this.backends.push(new backend(this.controller, listItem));
        }
    }

    /** Save the presentation.
     *
     * This method delegates the operation to the current {@link module:backend/AbstractBackend.AbstractBackend|backend} instance and triggers
     *
     * @returns {Promise} - A promise that will be resolved when the operation completes.
     *
     * @see {@linkcode module:backend/AbstractBackend.AbstractBackend#doAutosave}
     */
    save() {
        return this.backend.doAutosave();
    }

    /** Reload the SVG document.
     *
     * This method is called automatically or on user demand when the SVG
     * document has changed.
     * It saves the presentation and reloads it completely with the new
     * SVG content.
     */
    async reload() {
        await this.save();
        const data = await this.backend.load(this.svgFileDescriptor);
        await this.loadSVGData(data);
    }

    /** Open an SVG file or a presentation file.
     *
     * A file whose name ends in `.sozi.json` is a presentation file
     * (see {@linkcode module:Storage.Storage#openPresentationFile|openPresentationFile}).
     * Another `.json` file is not opened: an error is notified and nothing is written.
     * Any other file is an SVG file.
     *
     * @param {any} fileDescriptor - A descriptor of the file to open.
     * @param {module:backend/AbstractBackend.AbstractBackend} backend - The selected backend to manage the presentation files.
     * @returns {Promise<boolean>} - A promise resolved with `false` if a presentation file
     *  or its SVG file could not be opened, or if the file is a `.json` file that is not a presentation file.
     */
    async open(fileDescriptor, backend) {
        const name = backend.getName(fileDescriptor);
        if (isPresentationFile(name)) {
            return this.openPresentationFile(fileDescriptor, backend);
        }
        if (/\.json$/i.test(name)) {
            const _ = this.controller.gettext;
            this.controller.error(Jed.sprintf(_("Not a presentation file: %s. The name of a presentation file ends in .sozi.json."), name));
            return false;
        }
        await this.setSVGFile(fileDescriptor, backend);
        return true;
    }

    /** Open a presentation file and the SVG file it names.
     *
     * The SVG file is given by the `svg` key of the presentation file,
     * relative to its directory, or is `<base>.svg` beside it.
     * If the file cannot be read, is not presentation data (a JSON object
     * with a `frames` array), or if the SVG file is not found, an error is
     * notified and nothing is written.
     *
     * @param {any} fileDescriptor - A descriptor of the presentation file.
     * @param {module:backend/AbstractBackend.AbstractBackend} backend - The selected backend to manage the presentation files.
     * @returns {Promise<boolean>} - A promise resolved with `false` if the presentation file or its SVG file could not be opened.
     */
    async openPresentationFile(fileDescriptor, backend) {
        const _        = this.controller.gettext;
        const name     = backend.getName(fileDescriptor);
        const location = backend.getLocation(fileDescriptor);
        const jsonPath = path.join(location, name);

        // Check the file before anything is written.
        let data, reason;
        try {
            data   = await backend.load(fileDescriptor);
            reason = presentationDataError(data);
        }
        catch (err) {
            reason = String(err && err.message || err);
        }
        if (reason) {
            this.controller.error(Jed.sprintf(_("Not a presentation file: %s: %s"), jsonPath, reason));
            return false;
        }
        const svg = JSON.parse(data).svg;
        const svgKey = typeof svg === "string" ? svg : "";

        const svgPath = svgOfPresentation(jsonPath, svgKey);
        const svgFileDescriptor = await backend.find(path.basename(svgPath), path.dirname(svgPath)).catch(() => null);
        if (!svgFileDescriptor) {
            this.controller.error(Jed.sprintf(_("File not found: %s."), svgPath));
            return false;
        }
        await this.setSVGFile(svgFileDescriptor, backend, {name, location});
        return true;
    }

    /** Assign an SVG file descriptor and backend.
     *
     * This method is called when opening a new SVG file.
     *
     * @param {any} fileDescriptor - A descriptor of the SVG file.
     * @param {module:backend/AbstractBackend.AbstractBackend} backend - The selected backend to manage the presentation files.
     * @param {?{name: string, location: any}} [presentationFile] - The presentation file, if not the default one for the SVG file.
     */
    async setSVGFile(fileDescriptor, backend, presentationFile = null) {
        this.svgFileDescriptor = fileDescriptor;
        this.presentationFile  = presentationFile;
        this.backend           = backend;
        const data = await this.backend.load(this.svgFileDescriptor);
        await this.loadSVGData(data);
    }

    /** Load the content of an SVG document.
     *
     * This method creates an {@link module:svg/SVGDocumentWrapper.SVGDocumentWrapper| SVG document wrapper}
     * with the given data and assigns it to the current presentation.
     * Then it loads the presentation data from the presentation file:
     * by default, a JSON file in the same folder, named after the SVG file.
     *
     * @param {string} data  - The content of an SVG file, as text.
     */
    async loadSVGData(data) {
        const _        = this.controller.gettext;
        const name     = this.backend.getName(this.svgFileDescriptor);
        const location = this.backend.getLocation(this.svgFileDescriptor);

        this.document = SVGDocumentWrapper.fromString(data);
        if (this.document.isValidSVG) {
            this.resolveRelativeURLs(location);
            this.presentation.setSVGDocument(this.document);
            const json = this.presentationFile || {name: presentationFiles(name).presentation, location};
            await this.openJSONFile(json.name, json.location);
        }
        else {
            this.controller.error(_("Document is not valid SVG."));
        }
    }

    /** Fix the href attribute of linked images when the target URL is relative.
     *
     * In linked images, the `href` attribute can be either an absolute URL
     * or a path relative to the location of the SVG file.
     * But in the presentation editor, URLs are relative to the location of
     * the `index.html` file of the application.
     * For this reason, we modify image URLs by prefixing all relative URLs
     * with the actual location of the SVG file.
     *
     * @param {string} location - The path or URL of the folder containing the current SVG file.
     */
    resolveRelativeURLs(location) {
        const XLINK_NS = "http://www.w3.org/1999/xlink";
        const xlinkNsAttrs = Array.from(this.document.root.attributes).filter(a => a.value === XLINK_NS);
        if (!xlinkNsAttrs.length) {
            return;
        }
        const xlinkPrefix = xlinkNsAttrs[0].name.replace(/^xmlns:/, "") + ":";

        for (let img of this.document.root.getElementsByTagName("image")) {
            const href = img.getAttribute(xlinkPrefix + "href");
            if (!/^[a-z]+:|^[/#]/.test(href)) {
                img.setAttribute(xlinkPrefix + "href", `${location}/${href}`);
            }
        }
    }

    /** Open presentation data from a JSON file.
     *
     * It the file does not exist, it is created and populated with the current
     * presentation data.
     *
     * The HTML files are named after the JSON file and written beside it,
     * or in the directory given by the `outputDir` key of the presentation
     * (created if missing) when locations are directory paths (Electron);
     * other backends ignore the key with a notification.
     * The `svg` key of the presentation is set to the current SVG file; if the
     * loaded key named another file, the JSON file needs saving, and a change
     * of an existing key is notified.
     *
     * @param {string} name - The name of the JSON file to open.
     * @param {any} location - The location of the file (backend-dependent).
     */
    async openJSONFile(name, location) {
        const _ = this.controller.gettext;

        // The SVG and JSON paths: absolute paths when locations are directory
        // paths (Electron), so that an absolute `svg` key compares equal;
        // bare names for other backends when both files are in the same location.
        const svgName     = this.backend.getName(this.svgFileDescriptor);
        const svgLocation = this.backend.getLocation(this.svgFileDescriptor);
        const [svgRef, jsonRef] = typeof location !== "string" && location === svgLocation ?
            [svgName, name] :
            [path.join(svgLocation, svgName), path.join(location, name)];

        let fileDescriptor;
        this.jsonLoadError = null;
        try {
            // Load presentation data and editor state from JSON file.
            fileDescriptor = await this.backend.find(name, location);
            const data = await this.backend.load(fileDescriptor);
            this.loadJSONData(data);
            if (path.normalize(svgOfPresentation(jsonRef, this.presentation.svgPath)) !== path.normalize(svgRef)) {
                const oldKey = this.presentation.svgPath;
                this.presentation.svgPath = svgKeyOf(svgRef, jsonRef);
                this.jsonNeedsSaving = true;
                // Adding a key to a presentation without one is not a change.
                if (oldKey) {
                    this.controller.info(Jed.sprintf(_("svg key changed from %s to %s"), oldKey, this.presentation.svgPath || _("(none)")));
                }
            }
        }
        catch (err) {
            // The file was found but could not be read or parsed.
            if (fileDescriptor) {
                this.jsonLoadError = err;
            }

            // If no JSON file is available, attempt to extract
            // presentation data from the SVG document, assuming
            // it has been generated from Sozi 13 or earlier.
            // Then save the extracted data to a JSON file.
            upgradeFromSVG(this.presentation, this.controller);
            this.presentation.svgPath = svgKeyOf(svgRef, jsonRef);

            // If the document contains frames, it means it was imported from Sozi 13.
            if (this.presentation.frames.length) {
                this.controller.info(_("Document was imported from Sozi 13 or earlier."));
            }

            // Create a JSON file for the presentation data.
            if (this.writeOnOpen) {
                fileDescriptor = await this.backend.create(name, location, "application/json", this.getJSONData());
            }
        }

        if (fileDescriptor && !this.jsonFileDescriptor) {
            this.jsonFileDescriptor = fileDescriptor;
            this.backend.autosave(fileDescriptor, () => this.jsonNeedsSaving, () => this.getJSONData());
        }

        this.controller.onLoad();

        if (!this.writeOnOpen) {
            return;
        }

        // The HTML files are named after the presentation file.
        let outputDir = this.presentation.outputDir;
        if (outputDir && typeof location !== "string") {
            this.controller.info(Jed.sprintf(_("outputDir is ignored here: the HTML files are written beside %s."), name));
            outputDir = "";
        }
        const files       = presentationFiles(svgName, name, {outputDir});
        const outLocation = outputDir ? path.resolve(location, files.outputDir) : location;
        if (outputDir) {
            this.controller.info(Jed.sprintf(_("HTML files are written to %s"), outLocation));
        }
        // TODO Save only if SVG is more recent than HTML.
        // An output directory that cannot be written must not abort the opening:
        // the JSON file and the editing session stay usable.
        try {
            await this.createHTMLFile(path.basename(files.html), outLocation);
            await this.createPresenterHTMLFile(path.basename(files.presenter), outLocation, path.basename(files.html));
        }
        catch (err) {
            this.controller.error(Jed.sprintf(_("Could not write the HTML files in %s: %s"), outLocation, err));
        }
    }

    /** Create the presentation HTML file if it does not exist.
     *
     * @param {string} name - The name of the HTML file to create.
     * @param {any} location - The location of the file (backend-dependent).
     */
    async createHTMLFile(name, location) {
        let fileDescriptor = await this.backend.find(name, location).catch(() => null);
        if (!fileDescriptor) {
            fileDescriptor = await this.backend.create(name, location, "text/html", this.exportHTML(location));
        }
        else if (this.controller.preferences.saveMode !== "manual") {
            await this.backend.save(fileDescriptor, this.exportHTML(location));
        }

        if (!this.htmlFileDescriptor) {
            this.htmlFileDescriptor = fileDescriptor;
            // The output location is fixed when the presentation is opened.
            this.backend.autosave(fileDescriptor, () => this.htmlNeedsSaving, () => this.exportHTML(location));
        }
    }

    /** Create the presenter console HTML file if it does not exist.
     *
     * @param {string} name - The name of the HTML file to create.
     * @param {any} location - The location of the file (backend-dependent).
     * @param {string} htmlFileName - The name of the presentation HTML file.
     */
    async createPresenterHTMLFile(name, location, htmlFileName) {
        const fileDescriptor = await this.backend.find(name, location).catch(() => null);
        if (fileDescriptor) {
            await this.backend.save(fileDescriptor, this.exportPresenterHTML(htmlFileName));
        }
        else {
            await this.backend.create(name, location, "text/html", this.exportPresenterHTML(htmlFileName));
        }
    }

    /**  Load the presentation data and set the initial state of the editor.
     *
     * @param {object} data - An object containing presentation data and the editor state, as loaded from a JSON file.
     */
    loadJSONData(data) {
        const storable = JSON.parse(data);
        upgradeFromStorable(storable);
        this.presentation.fromStorable(storable);
        this.controller.fromStorable(storable);
        this.selection.fromStorable(storable);
    }

    /** Finalize a save operation.
     *
     * This method is called by the current backend when a save operation has
     * completed.
     *
     * @param {any} fileDescriptor - A descriptor of the file that was saved.
     *
     * @fires module:Controller.repaint
     */
    onSave(fileDescriptor) {
        const _ = this.controller.gettext;

        if (this.backend.sameFile(fileDescriptor, this.jsonFileDescriptor)) {
            this.jsonNeedsSaving = false;
        }
        else if (this.backend.sameFile(fileDescriptor, this.htmlFileDescriptor)) {
            this.htmlNeedsSaving = false;
        }

        this.controller.emit("repaint"); // TODO move this to controller
        this.controller.info(Jed.sprintf(_("Saved %s."), this.backend.getName(fileDescriptor)));
    }

    /** Extract the data to save from the current presentation and the current editor state.
     *
     * @returns {string} - A JSON representation of the presentation data and editor state.
     */
    getJSONData() {
        const storable = {};
        for (let object of [this.presentation, this.selection, this.controller]) {
            const partial = object.toStorable();
            for (let key in partial) {
                storable[key] = partial[key];
            }
        }
        return JSON.stringify(storable, null, "  ");
    }

    /** Generate the content of the presentation HTML file.
     *
     * The result is derived from the `player.html` template.
     * It contains a copy of the following items:
     * - the SVG document,
     * - the presentation data needed by the player,
     * - a copy of the custom style sheets and scripts.
     *
     * When the HTML file is written in another directory than the SVG file,
     * the relative image and media hrefs of the SVG document are rewritten
     * so that they resolve from the HTML file
     * (see {@linkcode module:hrefs.rewriteRelativeHrefs|rewriteRelativeHrefs}).
     *
     * @param {any} [location] - The location of the HTML file (backend-dependent);
     *  by default, the location of the SVG file. Only directory paths (Electron) are compared.
     * @returns {string} - An HTML document content, as text.
     */
    exportHTML(location) {
        const svgLocation = this.backend.getLocation(this.svgFileDescriptor);
        const svg = typeof location === "string" && typeof svgLocation === "string" ?
            rewriteRelativeHrefs(this.document.asText, svgLocation, location) :
            this.document.asText;
        return nunjucks.render("player.html", {
            svg,
            pres: this.presentation,
            // Inline script: "<" could close the script element ("</script>") or
            // keep it open ("<!--<script>"), and U+2028/U+2029 are line terminators
            // in older JavaScript engines.
            json: JSON.stringify(this.presentation.toMinimalStorable())
                .replace(/</g, "\\u003c")
                .replace(/\u2028/g, "\\u2028")
                .replace(/\u2029/g, "\\u2029"),
            customCSS: this.readCustomFiles(".css"),
            customJS: this.readCustomFiles(".js")
        });
    }

    /** Generate the content of the presenter console HTML file.
     *
     * The result is derived from the `presenter.html` template.
     *
     * @param {string} htmlFileName - The name of the presentation HTML file to play.
     * @returns {string} - An HTML document content, as text.
     */
    exportPresenterHTML(htmlFileName) {
        return nunjucks.render("presenter.html", {
            pres: this.presentation,
            soziHtml: htmlFileName
        });
    }

    /** Get the path of a file relative to the location of the current SVG file.
     *
     * @param {string} filePath - The path of a file.
     * @returns {string} - The path of the same file, relative to the location of the current SVG file.
     */
    toRelativePath(filePath) {
        const svgLoc = this.backend.getLocation(this.svgFileDescriptor);
        return path.relative(svgLoc, filePath);
    }

    /** Read custom files to include in the presentation HTML.
     *
     * @param {string} ext - The extension of the files to read.
     * @returns {string} - The concatenated content of all the files read.
     */
    readCustomFiles(ext) {
        const svgLoc = this.backend.getLocation(this.svgFileDescriptor);
        const paths = this.presentation.customFiles.filter(path => path.endsWith(ext));
        const contents = paths.map(relPath => {
            const absPath = path.join(svgLoc, relPath);
            return this.backend.loadSync(absPath);
        });
        return contents.join("\n");
    }
}
