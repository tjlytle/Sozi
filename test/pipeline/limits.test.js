// test/pipeline/limits.test.js: pausing a harness at its usage limit and choosing where a stage runs.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {chooseHarness, clearHarness, pauseHarness, pausedUntil} from "../../pipeline/lib/limits.js";

const MIN = 60 * 1000;
const NOW = Date.parse("2026-11-10T10:00:00Z");
const at = (/** @type {number} */ ms) => new Date(ms).toISOString();

describe("pauseHarness", () => {
    test("with no reset named, the back-off doubles for each limit in a row", () => {
        const first = pauseHarness({}, "claude", {resetAt: null, backoffMinutes: 15, now: NOW});
        assert.deepEqual(first, {until: at(NOW + 15 * MIN), streak: 1, reported: false});
        const second = pauseHarness({claude: first}, "claude", {
            resetAt: null,
            backoffMinutes: 15,
            now: NOW
        });
        assert.deepEqual(second, {until: at(NOW + 30 * MIN), streak: 2, reported: false});
    });
    test("the back-off is capped at two hours", () => {
        const limits = {claude: {until: at(NOW), streak: 10, reported: false}};
        const entry = pauseHarness(limits, "claude", {resetAt: null, backoffMinutes: 15, now: NOW});
        assert.equal(entry.until, at(NOW + 120 * MIN));
        assert.equal(entry.streak, 11);
    });
    test("a reported reset wins over the back-off", () => {
        const resetAt = new Date(NOW + 5 * 60 * MIN);
        const entry = pauseHarness({}, "claude", {resetAt, backoffMinutes: 15, now: NOW});
        assert.deepEqual(entry, {until: resetAt.toISOString(), streak: 1, reported: true});
    });
    test("a limit on one harness leaves the streak of another alone", () => {
        const limits = {codex: {until: at(NOW), streak: 3, reported: false}};
        const entry = pauseHarness(limits, "claude", {resetAt: null, backoffMinutes: 15, now: NOW});
        assert.equal(entry.streak, 1);
    });
});

describe("clearHarness and pausedUntil", () => {
    test("clearing drops the harness and keeps the others", () => {
        const limits = {
            claude: {until: at(NOW + MIN), streak: 1, reported: false},
            codex: {until: at(NOW + MIN), streak: 1, reported: false}
        };
        assert.deepEqual(Object.keys(clearHarness(limits, "claude")), ["codex"]);
        assert.equal(Object.keys(limits).length, 2, "the limits passed in are not changed");
    });
    test("a harness is paused until its time, and not after", () => {
        const limits = {claude: {until: at(NOW + MIN), streak: 1, reported: false}};
        assert.equal(pausedUntil(limits, "claude", NOW), at(NOW + MIN));
        assert.equal(pausedUntil(limits, "claude", NOW + MIN), null);
        assert.equal(pausedUntil(limits, "codex", NOW), null);
        assert.equal(pausedUntil(undefined, "claude", NOW), null);
    });
});

describe("chooseHarness", () => {
    const route = {harness: "claude", model: "claude-opus-5-5"};
    const fallbacks = [
        {harness: "codex", model: "gpt-5.5"},
        {harness: "agy", model: "gemini-3-pro"}
    ];
    const paused = (/** @type {string[]} */ ...harnesses) =>
        Object.fromEntries(
            harnesses.map(h => [h, {until: at(NOW + 60 * MIN), streak: 1, reported: true}])
        );

    test("a harness that is not paused runs its own route", () => {
        for (const policy of ["wait", "fallback"]) {
            const choice = chooseHarness({
                route,
                fallbacks,
                policy,
                limits: paused("codex"),
                now: NOW
            });
            assert.deepEqual(choice, route);
        }
    });
    test("under wait, a paused harness waits until its reset", () => {
        const choice = chooseHarness({
            route,
            fallbacks,
            policy: "wait",
            limits: paused("claude"),
            now: NOW
        });
        assert.deepEqual(choice, {wait: at(NOW + 60 * MIN)});
    });
    test("under fallback, the first entry runs instead", () => {
        const choice = chooseHarness({
            route,
            fallbacks,
            policy: "fallback",
            limits: paused("claude"),
            now: NOW
        });
        assert.deepEqual(choice, {harness: "codex", model: "gpt-5.5", fallbackFrom: "claude"});
    });
    test("a paused fallback is skipped", () => {
        const choice = chooseHarness({
            route,
            fallbacks,
            policy: "fallback",
            limits: paused("claude", "codex"),
            now: NOW
        });
        assert.deepEqual(choice, {harness: "agy", model: "gemini-3-pro", fallbackFrom: "claude"});
    });
    test("with no fallback left, the stage waits", () => {
        const limits = paused("claude", "codex", "agy");
        const choice = chooseHarness({route, fallbacks, policy: "fallback", limits, now: NOW});
        assert.deepEqual(choice, {wait: at(NOW + 60 * MIN)});
        const none = chooseHarness({route, fallbacks: [], policy: "fallback", limits, now: NOW});
        assert.deepEqual(none, {wait: at(NOW + 60 * MIN)});
    });
});
