// test/pipeline/logins.test.js: marking a persona logged out, and the credentials change that
// lifts the mark.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {emptyState} from "../../pipeline/lib/state.js";
import {loggedOutLines, markLoggedOut, stillLoggedOut} from "../../pipeline/lib/logins.js";

const SINCE = "2026-10-23T10:00:00.000Z";

describe("logins", () => {
    test("a mark holds, is new only once, and keeps its first time", () => {
        const state = emptyState();
        assert.equal(markLoggedOut(state, "builder", SINCE), true);
        assert.equal(markLoggedOut(state, "builder", "2026-10-23T11:00:00.000Z"), false);
        assert.deepEqual(state.run.loggedOut, {builder: {since: SINCE}});
        assert.equal(stillLoggedOut(state, "builder", null), true);
        assert.equal(stillLoggedOut(state, "qa", null), false);
    });
    test("credentials changed after the mark lift it", () => {
        const state = emptyState();
        markLoggedOut(state, "builder", SINCE);
        assert.equal(stillLoggedOut(state, "builder", "2026-10-23T10:05:00.000Z"), false);
        assert.deepEqual(state.run.loggedOut, {});
    });
    test("credentials changed before the mark keep it", () => {
        const state = emptyState();
        markLoggedOut(state, "builder", SINCE);
        assert.equal(stillLoggedOut(state, "builder", "2026-10-23T09:00:00.000Z"), true);
        assert.ok(state.run.loggedOut.builder);
    });
    test("one line per marked persona, naming the login command", () => {
        const state = emptyState();
        assert.deepEqual(loggedOutLines(state), []);
        markLoggedOut(state, "builder", SINCE);
        assert.deepEqual(loggedOutLines(state), [
            "builder: logged out; run npm run pipeline -- --login builder"
        ]);
    });
});
