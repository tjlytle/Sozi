/* Internationalization: the message catalog, the translations and the locales module. */

const {src, series} = require("gulp");
const newer = require("gulp-newer");
const streamExec = require("gulp-exec");
const util = require("util");
const jspot = require("jspot");
const po2json = util.promisify(require("po2json").parseFile);
const {writeFile, newerFiles} = require("./files.js");

/**
 * Extract the translatable messages of src/ into locales/messages.pot.
 *
 * @returns {Promise<void>} Resolves when the catalog is written.
 */
async function jspotTask() {
    const files = await newerFiles("src/**/*.js", "locales/messages.pot");
    if (files.length) {
        jspot.extract({
            keyword: "_",
            parserOptions: {
                sourceType: "module",
                // acorn 5.7 in jspot: 10 is the highest it parses; no ES2020 syntax in src/
                // until jspot is replaced; config/eslintrc.mjs lints src/**/*.js at ES2019 to match
                ecmaVersion: 10
            },
            source: files,
            target: "locales"
        });
    }
}

/**
 * Merge the message catalog into each translation.
 *
 * @returns {object} The stream of translation files.
 */
function msgmergeTask() {
    return src("locales/*.po", {read: false})
        .pipe(newer({dest: "locales", extra: "locales/messages.pot"}))
        .pipe(
            streamExec(file => `msgmerge -U ${file.path} locales/messages.pot`, {
                continueOnError: true
            })
        );
}

/**
 * Make a task that writes every translation into one module of a build.
 *
 * @param {string} target - The build: "electron" or "browser".
 * @returns {Function} The task.
 */
function makePo2JsonTask(target) {
    return async function po2jsonTask() {
        const destPath = `build/${target}/src/js/locales.js`;
        const files = await newerFiles("locales/*.po", destPath);
        if (files.length) {
            // Convert each file to a JS object.
            const data = await Promise.all(
                files.map(f =>
                    po2json(f, {
                        fuzzy: false,
                        format: "jed"
                    })
                )
            );
            // Merge all JS objects.
            const obj = {};
            for (const item of data) {
                obj[item.locale_data.messages[""].lang] = item;
            }
            // Convert the result to a nodejs module.
            const content = `module.exports = ${JSON.stringify(obj)};`;
            // Write the result to the app folders.
            await writeFile(destPath, content);
        }
    };
}

/**
 * The translations of a build: extract, merge, then write the locales module.
 *
 * @param {string} target - The build: "electron" or "browser".
 * @returns {Function} The task.
 */
function translationsTask(target) {
    return series(jspotTask, msgmergeTask, makePo2JsonTask(target));
}

module.exports = {jspotTask, msgmergeTask, makePo2JsonTask, translationsTask};
