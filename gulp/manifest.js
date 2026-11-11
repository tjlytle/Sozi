/* The application manifest and the Node dependencies of a build. */

const {series} = require("gulp");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const modclean = require("modclean");
const {writeFile} = require("./files.js");
const {soziVersion} = require("./version.js");

/**
 * Make a task that writes a build's package.json, without the development dependencies.
 *
 * @param {string} target - The build: "electron" or "browser".
 * @param {object} [opts] - Fields that replace the root package.json's.
 * @returns {Function} The task.
 */
function makePackageJsonTask(target, opts = {}) {
    return async function packageJsonTask() {
        const pkg = {
            ...require("../package.json"),
            ...opts,
            version: soziVersion()
        };
        delete pkg.devDependencies;
        delete pkg.optionalDependencies;
        await writeFile(`build/${target}/package.json`, JSON.stringify(pkg));
    };
}

/**
 * Make a task that installs a build's production dependencies and cleans them.
 *
 * @param {string} target - The build: "electron" or "browser".
 * @returns {Function} The task.
 */
function makeInstallDepsTask(target) {
    return async function installDepsTask() {
        await exec(
            "npm install --only=prod \
                                --no-audit \
                                --no-fund \
                                --no-optional \
                                --no-package-lock",
            {cwd: `build/${target}`}
        );
        await modclean({cwd: `build/${target}/node_modules`}).clean();
    };
}

/**
 * A build's Node package: its package.json, then its dependencies.
 *
 * @param {string} target - The build: "electron" or "browser".
 * @param {object} [opts] - Fields that replace the root package.json's.
 * @returns {Function} The task.
 */
function nodePackageTask(target, opts) {
    return series(makePackageJsonTask(target, opts), makeInstallDepsTask(target));
}

module.exports = {makePackageJsonTask, makeInstallDepsTask, nodePackageTask};
