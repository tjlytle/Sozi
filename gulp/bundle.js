/* Transpile, bundle and collect the source files of the application. */

const {src, dest, parallel} = require("gulp");
const newer = require("gulp-newer");
const babel = require("gulp-babel");
const browserify = require("browserify");
const uglify = require("gulp-uglify");
const envify = require("envify/custom");
const source = require("vinyl-source-stream");
const buffer = require("vinyl-buffer");
const {makeCopyTask, makeRenameTask} = require("./files.js");

/**
 * Make a task that transpiles src/js with Babel into a build.
 *
 * @param {string} target - The build: "electron" or "browser".
 * @param {object} opts - The options of @babel/preset-env.
 * @returns {Function} The task.
 */
function makeTranspileTask(target, opts) {
    const destPath = `build/${target}/src/js/`;
    return function transpileTask() {
        return src("src/js/**/*.js")
            .pipe(newer(destPath))
            .pipe(
                babel({
                    presets: [["@babel/preset-env", opts]]
                })
            )
            .pipe(dest(destPath));
    };
}

/**
 * Make a task that bundles and minifies one page's script into build/tmp.
 *
 * @param {string} name - The page: "player" or "presenter".
 * @returns {Function} The task.
 */
function makeBrowserifyTask(name) {
    return function browserifyTask() {
        // TODO Use newer
        return browserify({
            entries: `build/browser/src/js/${name}.js`,
            debug: false
        })
            .bundle()
            .pipe(source(`${name}.js`))
            .pipe(buffer())
            .pipe(
                uglify({
                    mangle: true,
                    compress: true
                })
            )
            .pipe(dest("build/tmp/"));
    };
}

/**
 * Bundle and minify the editor for the browser build.
 *
 * @returns {object} The stream of the bundle.
 */
function browserEditorBrowserifyTask() {
    // TODO Use newer
    return browserify({
        entries: "build/browser/src/js/editor.js",
        external: ["electron", "fs", "process", "officegen", "pdf-lib"],
        debug: false,
        transform: [[envify({_: "purge", NODE_ENV: "production"}), {global: true}]]
    })
        .bundle()
        .pipe(source("editor.min.js"))
        .pipe(buffer())
        .pipe(
            uglify({
                mangle: true,
                compress: true
            })
        )
        .pipe(dest("build/browser/src/js/"));
}

/** Transpile src/js for Electron's Node. */
const electronTranspileTask = makeTranspileTask("electron", {targets: {node: "20"}});

/** Transpile src/js for browsers, with the core-js polyfills it uses. */
const browserTranspileTask = makeTranspileTask("browser", {useBuiltIns: "usage", corejs: 3});

/** Bundle the player's and the presenter's scripts. */
const playerBrowserifyTask = parallel(
    makeBrowserifyTask("player"),
    makeBrowserifyTask("presenter")
);

/** Copy the stylesheets into the Electron build. */
const electronCssCopyTask = makeCopyTask("src/css/**/*.css", `build/electron/src/css/`);

/** Copy the stylesheets into the browser build. */
const browserCssCopyTask = makeCopyTask("src/css/**/*.css", `build/browser/src/css/`);

/** The Electron build's index.html. */
const electronIndexRenameTask = makeRenameTask(
    "src/index-electron.html",
    "build/electron/src/index.html"
);

/** The Electron backend as the build's backend/index.js. */
const electronBackendIndexRenameTask = makeRenameTask(
    "build/electron/src/js/backend/index-electron.js",
    "build/electron/src/js/backend/index.js"
);

/** The Electron exporter as the build's exporter/index.js. */
const electronExporterRenameTask = makeRenameTask(
    "build/electron/src/js/exporter/index-electron.js",
    "build/electron/src/js/exporter/index.js"
);

/** The browser build's index.html. */
const browserIndexRenameTask = makeRenameTask("src/index-browser.html", "build/browser/index.html");

/** The browser backend as the build's backend/index.js. */
const browserBackendIndexRenameTask = makeRenameTask(
    "build/browser/src/js/backend/index-browser.js",
    "build/browser/src/js/backend/index.js"
);

/** The browser exporter as the build's exporter/index.js. */
const browserExporterRenameTask = makeRenameTask(
    "build/browser/src/js/exporter/index-browser.js",
    "build/browser/src/js/exporter/index.js"
);

/** Copy the favicon into the browser build. */
const browserFaviconCopyTask = makeCopyTask("resources/icons/favicon.ico", "build/browser");

module.exports = {
    makeTranspileTask,
    makeBrowserifyTask,
    browserEditorBrowserifyTask,
    electronTranspileTask,
    browserTranspileTask,
    playerBrowserifyTask,
    electronCssCopyTask,
    browserCssCopyTask,
    electronIndexRenameTask,
    electronBackendIndexRenameTask,
    electronExporterRenameTask,
    browserIndexRenameTask,
    browserBackendIndexRenameTask,
    browserExporterRenameTask,
    browserFaviconCopyTask
};
