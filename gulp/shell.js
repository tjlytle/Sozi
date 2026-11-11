/* The hosted presenter shell: static files that any host can serve, at any path. */

const {Environment} = require("nunjucks");
const fs = require("fs");
const {writeFile, copyFile} = require("./files.js");
const {soziVersion} = require("./version.js");
const {templateFiles} = require("./templates.js");

const shellDir = "build/shell";

/**
 * Every file the service worker keeps, relative to it. "./" is what a link to the shell asks for.
 */
const shellFiles = [
    "./",
    "index.html",
    "manifest.webmanifest",
    "addons.js",
    "icons/192x192.png",
    "icons/512x512.png"
];

/**
 * Write the shell's files. It needs build/tmp/presenter.js: the default task builds it first.
 *
 * @returns {Promise<void>} Resolves when they are written.
 */
async function shellBuildTask() {
    const engine = new Environment(null, {autoescape: false});
    const template = fs.readFileSync("src/templates/presenter.html", "utf8");
    // The same two renderings as a deck's presenter page: the build's, then the page's own.
    const compiled = engine.renderString(template, templateFiles("build/tmp/presenter.js"));
    await writeFile(`${shellDir}/index.html`, engine.renderString(compiled, {shell: true}));
    const worker = fs.readFileSync("src/templates/sw.js", "utf8");
    await writeFile(
        `${shellDir}/sw.js`,
        engine.renderString(worker, {version: soziVersion(), files: shellFiles})
    );
    await copyFile("src/shell/manifest.webmanifest", `${shellDir}/manifest.webmanifest`);
    await copyFile("src/shell/addons.js", `${shellDir}/addons.js`);
    await copyFile("resources/icons/192x192.png", `${shellDir}/icons/192x192.png`);
    await copyFile("resources/icons/512x512.png", `${shellDir}/icons/512x512.png`);
}

module.exports = {shellFiles, shellBuildTask};
