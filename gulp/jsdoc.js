/* The API documentation of src/. */

const {src} = require("gulp");
const jsdoc = require("gulp-jsdoc3");

/**
 * Writes the API documentation of `src/` with JSDoc.
 *
 * @param {Function} cb - Called by gulp-jsdoc3 when the documentation is written.
 * @returns {object} The stream of source files piped into JSDoc.
 */
function jsdocTask(cb) {
    const config = require("../config/jsdoc.json");
    return src("./src/**/*.js", {read: false}).pipe(jsdoc(config, cb));
}

module.exports = {jsdocTask};
