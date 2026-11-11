/* The version number of a build. */

const {execSync} = require("child_process");

const cache = new Map();

/**
 * Sozi's version, YY.MM.DD-T, from the date and timestamp of the last commit.
 * Git runs on the first call only.
 *
 * @returns {string} The version.
 */
function soziVersion() {
    if (!cache.has("version")) {
        const rev = execSync('git show -s --format="%cI %ct"').toString().trim().split(" ");
        const year = rev[0].slice(2, 4);
        const month = rev[0].slice(5, 7);
        const day = rev[0].slice(8, 10);
        const tstamp = rev[1];
        cache.set("version", `${year}.${month}.${day}-${tstamp}`);
    }
    return cache.get("version");
}

module.exports = {soziVersion};
