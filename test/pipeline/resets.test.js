// test/pipeline/resets.test.js: the reset time a harness CLI names in its usage-limit message.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {resetTime} from "../../pipeline/lib/resets.js";

const NOW = new Date("2026-11-10T10:00:00Z");

/**
 * The reset an adapter's limit text names, as an ISO string, or null.
 *
 * @param {string} text - The limit text.
 * @param {Date} [now] - The current time.
 * @param {string} [zone] - The zone a time with no named zone is in.
 * @returns {string | null} - The reset time.
 */
const reset = (text, now = NOW, zone = "UTC") => resetTime(text, now, zone)?.toISOString() ?? null;

describe("resetTime", () => {
    test("reads a time of day with a named zone", () => {
        // Paris is at UTC+1 in November.
        assert.equal(
            reset("You've hit your limit · resets 3pm (Europe/Paris)"),
            "2026-11-10T14:00:00.000Z"
        );
    });
    test("a named zone wins over the local zone", () => {
        assert.equal(
            reset("resets 9am (America/New_York)", NOW, "Europe/Paris"),
            "2026-11-10T14:00:00.000Z"
        );
    });
    test("a time of day with no zone is in the local zone", () => {
        assert.equal(reset("You've hit your limit · resets 3pm"), "2026-11-10T15:00:00.000Z");
        assert.equal(
            reset("You've hit your limit · resets 3pm", NOW, "Europe/Paris"),
            "2026-11-10T14:00:00.000Z"
        );
    });
    test("reads a duration", () => {
        assert.equal(
            reset("Rate limited. Try again in 2 hours 13 minutes."),
            "2026-11-10T12:13:00.000Z"
        );
        assert.equal(reset("try again in 45 minutes"), "2026-11-10T10:45:00.000Z");
        assert.equal(reset("try again in 1 hour"), "2026-11-10T11:00:00.000Z");
    });
    test("reads a clock time with minutes", () => {
        assert.equal(
            reset("You have hit your usage limit. Try again at 3:05 PM."),
            "2026-11-10T15:05:00.000Z"
        );
        assert.equal(reset("try again at 9:30 am"), "2026-11-11T09:30:00.000Z");
    });
    test("a time already past rolls to the next day", () => {
        const late = new Date("2026-11-10T16:00:00Z");
        assert.equal(reset("Try again at 3:05 PM.", late), "2026-11-11T15:05:00.000Z");
        assert.equal(reset("resets 3pm (Europe/Paris)", late), "2026-11-11T14:00:00.000Z");
    });
    test("reads an epoch suffix", () => {
        assert.equal(reset("Claude AI usage limit reached|1794322800"), "2026-11-10T15:00:00.000Z");
    });
    test("garbage, an unknown zone, a past epoch and anything over 7 days give null", () => {
        assert.equal(reset("API rate limit reached"), null);
        assert.equal(reset(""), null);
        assert.equal(reset("resets 3pm (Mars/Olympus)"), null);
        assert.equal(reset("resets 13pm"), null);
        assert.equal(reset("usage limit reached|1700000000"), null);
        assert.equal(reset("try again in 200 hours"), null);
        assert.equal(reset("usage limit reached|1894322800"), null);
    });
});
