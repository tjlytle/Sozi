/* Files on disk and streams of files: the helpers every build module shares. */

const {src, dest} = require("gulp");
const newer = require("gulp-newer");
const rename = require("gulp-rename");
const util = require("util");
const path = require("path");
const fs = require("fs");

const writeFile_ = util.promisify(fs.writeFile);
const mkdir_ = util.promisify(fs.mkdir);
const copyFile_ = util.promisify(fs.copyFile);

/**
 * Create a directory and its parents.
 *
 * @param {string} dirPath - The directory.
 * @returns {Promise<string|undefined>} Resolves when it exists.
 */
function mkdir(dirPath) {
    return mkdir_(dirPath, {recursive: true});
}

/**
 * Write a file, creating its directory first.
 *
 * @param {string} name - The file.
 * @param {string|Buffer} content - What to write.
 * @returns {Promise<void>} Resolves when it is written.
 */
async function writeFile(name, content) {
    await mkdir(path.dirname(name));
    await writeFile_(name, content);
}

/**
 * Copy a file, creating the destination's directory first.
 *
 * @param {string} from - The file to copy.
 * @param {string} to - Where the copy goes.
 * @returns {Promise<void>} Resolves when it is copied.
 */
async function copyFile(from, to) {
    await mkdir(path.dirname(to));
    await copyFile_(from, to);
}

/**
 * Make a task that copies the files newer than their copies.
 *
 * @param {string} fromPath - A glob of the files to copy.
 * @param {string} toPath - The destination directory.
 * @returns {Function} The task.
 */
function makeCopyTask(fromPath, toPath) {
    return function copyTask() {
        return src(fromPath, {allowEmpty: true}).pipe(newer(toPath)).pipe(dest(toPath));
    };
}

/**
 * Make a task that copies one file under a new name when it is newer than the copy.
 *
 * @param {string} fromPath - The file to copy.
 * @param {string} toPath - The copy's path, name included.
 * @returns {Function} The task.
 */
function makeRenameTask(fromPath, toPath) {
    return function renameTask() {
        return src(fromPath, {allowEmpty: true})
            .pipe(newer(toPath))
            .pipe(rename(path.basename(toPath)))
            .pipe(dest(path.dirname(toPath)));
    };
}

/**
 * Collect everything a stream emits.
 *
 * @param {object} stream - The stream.
 * @returns {Promise<Array>} Resolves with the items when the stream ends.
 */
function toArray(stream) {
    return new Promise((resolve, reject) => {
        const res = [];
        stream.on("data", data => res.push(data));
        stream.on("end", err => {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        });
    });
}

/**
 * List the files newer than a destination.
 *
 * @param {string} srcGlob - A glob of the source files.
 * @param {string} destPath - The destination they are compared with.
 * @returns {Promise<string[]>} Resolves with their paths, relative to the working directory.
 */
async function newerFiles(srcGlob, destPath) {
    const files = await toArray(src(srcGlob, {read: false}).pipe(newer(destPath)));
    return files.map(f => path.relative(process.cwd(), f.path));
}

module.exports = {
    mkdir,
    writeFile,
    copyFile,
    makeCopyTask,
    makeRenameTask,
    toArray,
    newerFiles
};
