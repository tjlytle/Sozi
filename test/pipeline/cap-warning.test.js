// test/pipeline/cap-warning.test.js: a running session is warned once, a few minutes before the cap.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {secondsToNextWarning, warnSessions, warnText} from "../../pipeline/lib/cap-warning.js";

const MINUTE = 60 * 1000;
const START = Date.parse("2026-11-12T20:00:00Z");

/**
 * A pass context with running sessions on a clock the test moves.
 *
 * @param {Record<number, any>} sessions - The sessions by issue; each gets an outbox.
 * @param {{sessionMinutes?: number, sessionWarnMinutes?: number}} [settings] - The settings.
 * @returns {any} The context, its clock (`t`) and its log lines.
 */
function context(sessions, {sessionMinutes = 75, sessionWarnMinutes = 5} = {}) {
    /** @type {any} */
    const ctx = {
        t: START,
        lines: [],
        settings: {sessionMinutes, sessionWarnMinutes},
        state: {issues: {}}
    };
    ctx.clock = {now: () => ctx.t};
    ctx.log = (/** @type {string} */ line) => ctx.lines.push(line);
    for (const [n, session] of Object.entries(sessions)) {
        ctx.state.issues[n] = {
            session: session && {
                outbox: fs.mkdtempSync(path.join(os.tmpdir(), "cap-")),
                started: new Date(START).toISOString(),
                stage: "build",
                ...session
            }
        };
    }
    return ctx;
}

/**
 * The warning in an issue session's outbox.
 *
 * @param {any} ctx - The context.
 * @param {number} n - The issue.
 * @returns {string | null} The text, or null when there is none.
 */
function warning(ctx, n) {
    const file = path.join(ctx.state.issues[n].session.outbox, "nudge-cap.md");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

describe("cap warning", () => {
    test("the text names the minutes left and the setting, and asks for a push", () => {
        const text = warnText(5);
        assert.match(text, /^The runner: this session is stopped in about 5 minutes/);
        assert.match(text, /PIPELINE_SESSION_MINUTES/);
        assert.match(text, /[Cc]ommit and push what you have now/);
        assert.doesNotMatch(text, /\n/);
    });

    test("is written once, at sessionMinutes - warnMinutes and not before", () => {
        const ctx = context({25: {}});
        ctx.t = START + 69 * MINUTE;
        warnSessions(ctx);
        assert.equal(warning(ctx, 25), null, "not before 70 minutes");
        ctx.t = START + 70 * MINUTE;
        warnSessions(ctx);
        assert.match(warning(ctx, 25) ?? "", /stopped in about 5 minutes/);
        assert.equal(ctx.state.issues[25].session.warned, true);
        assert.deepEqual(ctx.lines, ["#25: warned 5 minutes before the cap"]);
        const outbox = ctx.state.issues[25].session.outbox;
        fs.renameSync(path.join(outbox, "nudge-cap.md"), path.join(outbox, "nudge-cap.seen"));
        ctx.t = START + 72 * MINUTE;
        warnSessions(ctx);
        assert.equal(warning(ctx, 25), null, "only once");
        assert.equal(ctx.lines.length, 1);
    });

    test("a late pass names the minutes really left", () => {
        const ctx = context({25: {}});
        ctx.t = START + 73 * MINUTE;
        warnSessions(ctx);
        assert.match(warning(ctx, 25) ?? "", /stopped in about 2 minutes/);
    });

    test("nothing is written when either setting is 0, or for a judged session", () => {
        for (const settings of [{sessionMinutes: 0}, {sessionWarnMinutes: 0}]) {
            const ctx = context({25: {}}, settings);
            ctx.t = START + 200 * MINUTE;
            warnSessions(ctx);
            assert.equal(warning(ctx, 25), null, JSON.stringify(settings));
        }
        const ctx = context({25: {judged: true}, 26: null});
        ctx.t = START + 70 * MINUTE;
        warnSessions(ctx);
        assert.equal(warning(ctx, 25), null);
        assert.deepEqual(ctx.lines, []);
    });

    test("secondsToNextWarning is the earliest warning still to come", () => {
        const later = new Date(START + 10 * MINUTE).toISOString();
        const ctx = context({25: {started: later}, 26: {}, 27: {judged: true}, 28: null});
        ctx.t = START + 60 * MINUTE;
        assert.equal(secondsToNextWarning(ctx.state, ctx.settings, ctx.t), 600);
        ctx.t = START + 70 * MINUTE;
        warnSessions(ctx);
        assert.equal(secondsToNextWarning(ctx.state, ctx.settings, ctx.t), 600, "#26 warned");
    });

    test("secondsToNextWarning is null when no warning is left", () => {
        const ctx = context({25: {warned: true}, 26: {judged: true}});
        assert.equal(secondsToNextWarning(ctx.state, ctx.settings, ctx.t), null);
        const off = context({25: {}}, {sessionWarnMinutes: 0});
        assert.equal(secondsToNextWarning(off.state, off.settings, off.t), null);
    });
});
