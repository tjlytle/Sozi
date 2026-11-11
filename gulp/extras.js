/* The extras: the Inkscape media add-ons, zipped for download. */

const {parallel} = require("gulp");
const util = require("util");
const path = require("path");
const exec = util.promisify(require("child_process").exec);
const {mkdir} = require("./files.js");
const {soziVersion} = require("./version.js");
const {distDir} = require("./package.js");

/**
 * Make a task that zips a directory into the distribution directory.
 *
 * @param {string} fromPath - The directory to zip.
 * @param {string} toPath - The archive.
 * @returns {Function} The task.
 */
function makeZipTask(fromPath, toPath) {
    const opts = {
        cwd: path.dirname(fromPath),
        stdio: "ignore"
    };
    const src = path.basename(fromPath);
    const dest = path.relative(opts.cwd, toPath);
    return async function zipTask() {
        await mkdir(distDir);
        await exec(`zip -ry ${dest} ${src}`, opts);
    };
}

/** Zip the media add-ons of both Inkscape versions. */
const extrasMediaCompressTask = parallel(
    makeZipTask(
        "extras/media-inkscape-0.92",
        `${distDir}/sozi-extras-media-${soziVersion()}-inkscape-0.92.zip`
    ),
    makeZipTask(
        "extras/media-inkscape-1.0",
        `${distDir}/sozi-extras-media-${soziVersion()}-inkscape-1.0.zip`
    )
);

module.exports = {makeZipTask, extrasMediaCompressTask};
