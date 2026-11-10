/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The reset time a harness CLI names when it stops at a usage limit. The adapters pass the
// CLI's text on as it is; the wordings are read here, where they can be tested.

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const MAX_AHEAD = 7 * DAY;

/** "|1731250800" at the end: the reset as epoch seconds. */
const EPOCH = /\|(\d{9,13})\s*$/;
/** "try again in 2 hours 13 minutes". */
const DURATION =
    /try again in\s+((?:\d+\s*(?:days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)(?:\s|,|and)*)+)/i;
/** "try again at 3:05 PM", "resets 3pm (Europe/Paris)", "resets at 9:30am". */
const CLOCK =
    /(?:try again at|resets?(?: at)?)\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?:\s*\(([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*)\))?/i;

/**
 * The milliseconds a "2 hours 13 minutes" text spans.
 *
 * @param {string} text - The duration.
 * @returns {number} - The span.
 */
function spanOf(text) {
    /** @type {Record<string, number>} */
    const units = {d: DAY, h: 60 * MINUTE, m: MINUTE, s: 1000};
    let total = 0;
    for (const [, n, unit] of text.matchAll(/(\d+)\s*([dhms])/gi)) {
        total += Number(n) * units[unit.toLowerCase()];
    }
    return total;
}

/**
 * The offset of a zone from UTC at an instant: its wall time read as UTC, minus the instant.
 *
 * @param {Date} at - The instant.
 * @param {string} zone - The IANA zone.
 * @returns {number} - The offset in milliseconds.
 */
function offsetAt(at, zone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric"
    }).formatToParts(at);
    const get = (/** @type {string} */ type) =>
        Number(parts.find(p => p.type === type)?.value ?? 0);
    const wall = Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour"),
        get("minute"),
        get("second")
    );
    return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The next instant after now at which a zone's clock shows a time of day.
 *
 * @param {Date} now - The current time.
 * @param {number} hour - The hour, 0 to 23.
 * @param {number} minute - The minute.
 * @param {string} zone - The IANA zone; throws a RangeError when unknown.
 * @returns {Date} - The instant.
 */
function nextClock(now, hour, minute, zone) {
    const today = new Date(now.getTime() + offsetAt(now, zone));
    for (let days = 0; days < 2; days++) {
        const wall = Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate() + days,
            hour,
            minute
        );
        // Twice, so a guess on the far side of a daylight-saving change settles.
        let at = wall - offsetAt(new Date(wall), zone);
        at = wall - offsetAt(new Date(at), zone);
        if (at > now.getTime()) {
            return new Date(at);
        }
    }
    return new Date(now.getTime() + DAY);
}

/**
 * The reset a time of day names, or null when its hour is not a clock hour or its zone is
 * unknown.
 *
 * @param {string[]} clock - The CLOCK match: hour, minute, a or p, and the zone named.
 * @param {Date} now - The current time.
 * @param {string} localZone - The zone when the text names none.
 * @returns {Date | null} - The reset.
 */
function clockReset(clock, now, localZone) {
    const [, h, m = "0", half, zone] = clock;
    const hour12 = Number(h);
    if (hour12 < 1 || hour12 > 12 || Number(m) > 59) {
        return null;
    }
    const hour = (hour12 % 12) + (half.toLowerCase() === "p" ? 12 : 0);
    try {
        return nextClock(now, hour, Number(m), zone ?? localZone);
    } catch {
        return null;
    }
}

/**
 * Read the reset time out of a usage-limit message: an epoch suffix ("…|1731250800"), a
 * duration ("try again in 2 hours 13 minutes"), or a time of day ("try again at 3:05 PM",
 * "resets 3pm (Europe/Paris)"). A time of day with no date is the next one; a named IANA zone
 * wins over the local one.
 *
 * @param {string} text - The CLI's limit message.
 * @param {Date} now - The current time.
 * @param {string} localZone - The IANA zone a time of day with no named zone is in.
 * @returns {Date | null} - The reset, or null when the text names none, or one that is past or
 *     more than 7 days ahead.
 */
export function resetTime(text, now, localZone) {
    let reset = null;
    const epoch = EPOCH.exec(text);
    const duration = DURATION.exec(text);
    const clock = CLOCK.exec(text);
    if (epoch) {
        const n = Number(epoch[1]);
        reset = new Date(n < 1e12 ? n * 1000 : n);
    } else if (duration) {
        reset = new Date(now.getTime() + spanOf(duration[1]));
    } else if (clock) {
        reset = clockReset(clock, now, localZone);
    }
    if (!reset) {
        return null;
    }
    const ahead = reset.getTime() - now.getTime();
    return ahead > 0 && ahead <= MAX_AHEAD ? reset : null;
}
