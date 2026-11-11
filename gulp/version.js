/* The version number of a build. */

const {execSync} = require("child_process");

/**
 * Formats a version, YY.MM.DD-T, from the date and timestamp of the last commit.
 *
 * @returns {string} The version.
 */
function versionFromLastCommit() {
    const rev = execSync('git show -s --format="%cI %ct"').toString().trim().split(" ");
    const year = rev[0].slice(2, 4);
    const month = rev[0].slice(5, 7);
    const day = rev[0].slice(8, 10);
    const tstamp = rev[1];
    return `${year}.${month}.${day}-${tstamp}`;
}

const VERSION = versionFromLastCommit();

/**
 * Sozi's version, YY.MM.DD-T, read from git once when this module loads.
 *
 * @returns {string} The version.
 */
function soziVersion() {
    return VERSION;
}

module.exports = {soziVersion};
