/* The pages' templates: what the build inlines in the first of their two renderings. */

const {src, dest} = require("gulp");
const newer = require("gulp-newer");
const nunjucks = require("gulp-nunjucks");
const fs = require("fs");

/** The presenter's component stylesheets, inlined in its page in this order. */
const PRESENTER_CSS = ["src/css/presenter/drawing-toolbar.css"];

/**
 * What a page's template inlines in the first of its two renderings.
 *
 * @param {string} jsPath - The page's bundled script.
 * @returns {object} The template's variables.
 */
function templateFiles(jsPath) {
    return {
        js: fs.readFileSync(jsPath),
        // The presenter's notes styles are inlined: nothing comes from a CDN (standard 4).
        markdownCss: fs.readFileSync("node_modules/github-markdown-css/github-markdown-light.css"),
        highlightCss: fs.readFileSync("node_modules/highlight.js/styles/github.min.css"),
        // The presenter's own component styles (standard 3.1).
        presenterCss: PRESENTER_CSS.map(file => fs.readFileSync(file)).join("\n")
    };
}

/**
 * Make a task that renders a page's template, with its bundled script inlined, into a build.
 *
 * @param {string} target - The build: "electron" or "browser".
 * @param {string} tpl - The page: "player" or "presenter".
 * @returns {Function} The task.
 */
function makeTemplateTask(target, tpl) {
    const jsPath = `build/tmp/${tpl}.js`;
    const destPath = `build/${target}/src/templates/`;
    return function templateTask() {
        return src(`src/templates/${tpl}.html`)
            .pipe(newer({dest: destPath, extra: [jsPath, ...PRESENTER_CSS]}))
            .pipe(nunjucks.compile(templateFiles(jsPath)))
            .pipe(dest(destPath));
    };
}

module.exports = {templateFiles, makeTemplateTask};
