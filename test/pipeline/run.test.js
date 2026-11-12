// test/pipeline/run.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {emptyState} from "../../pipeline/lib/state.js";
import {closeRun, finishDigest, openRun} from "../../pipeline/lib/run.js";

/**
 * Finish the digest of a run on page-1 with a digest command that exits with a code.
 *
 * @param {number} code - The exit status of the digest command.
 * @param {{notionPage?: string | null, env?: Record<string, string>}} [run] - What to change
 *     on the run, and the environment it finishes in.
 * @returns {Promise<{finished: boolean, calls: string[][], lines: string[]}>} - The result,
 *     the commands and the log.
 */
async function finish(code, {notionPage = "page-1", env = {NOTION_TOKEN: "nt"}} = {}) {
    const state = emptyState();
    state.run.notionPage = notionPage;
    /** @type {string[][]} */
    const calls = [];
    /** @type {string[]} */
    const lines = [];
    const finished = await finishDigest({
        state,
        reason: "finished by hand",
        settings: {repo: "tjlytle/Sozi", evidence: {url: ""}},
        root: "/nowhere",
        env,
        log: line => lines.push(line),
        deps: {
            run: async () => ({code: 1, stdout: "", stderr: ""}),
            startMint: /** @type {any} */ (null),
            digest: async argv => {
                calls.push(argv);
                return code;
            }
        }
    });
    return {finished, calls, lines};
}

/**
 * Close a running run on page-1 with a digest command that exits with a code.
 *
 * @param {number} code - The exit status of the digest command.
 * @param {Record<string, string>} [env] - The environment it closes in.
 * @returns {Promise<{closed: boolean, state: any, calls: string[][]}>} - The result, the
 *     state after it and the commands.
 */
async function close(code, env = {NOTION_TOKEN: "nt"}) {
    const state = emptyState();
    state.run.notionPage = "page-1";
    /** @type {string[][]} */
    const calls = [];
    const closed = await closeRun({
        state,
        reason: "until reached",
        settings: {repo: "tjlytle/Sozi", evidence: {url: ""}},
        root: "/nowhere",
        env,
        log: () => {},
        deps: {
            run: async () => ({code: 1, stdout: "", stderr: ""}),
            startMint: /** @type {any} */ (null),
            digest: async argv => {
                calls.push(argv);
                return code;
            }
        }
    });
    return {closed, state, calls};
}

describe("pipeline/lib/run.js", () => {
    test("finishDigest is finished when the summary was posted", async () => {
        const {finished, calls} = await finish(0);
        assert.equal(finished, true);
        assert.equal(calls[0][0], "finish");
    });
    test("finishDigest is finished when there is no page to post to", async () => {
        const {finished, calls} = await finish(0, {notionPage: null});
        assert.equal(finished, true);
        assert.equal(calls.length, 0);
    });
    test("finishDigest is not finished when the summary could not be posted", async () => {
        const {finished} = await finish(1);
        assert.equal(finished, false);
    });
    test("finishDigest is not finished when the run has a page but no NOTION_TOKEN", async () => {
        const {finished, calls, lines} = await finish(0, {env: {}});
        assert.equal(finished, false);
        assert.equal(calls.length, 0);
        assert.match(lines.join("\n"), /no NOTION_TOKEN/);
    });
    test("finishDigest is finished when there is neither a page nor a token", async () => {
        const {finished, calls} = await finish(0, {notionPage: null, env: {}});
        assert.equal(finished, true);
        assert.equal(calls.length, 0);
    });
    test("closeRun stops the run and clears closing when the summary posts", async () => {
        const {closed, state, calls} = await close(0);
        assert.equal(closed, true);
        assert.equal(state.run.stopped, true);
        assert.equal(state.run.closing, null);
        assert.match(calls[0].join(" "), /Stopped: until reached\./);
    });
    test("closeRun leaves the run open and closing when the summary fails", async () => {
        const {closed, state} = await close(1);
        assert.equal(closed, false);
        assert.equal(state.run.stopped, false);
        assert.equal(state.run.closing, "until reached");
    });
    test("closeRun leaves the run open and closing with a page but no token", async () => {
        const {closed, state, calls} = await close(0, {});
        assert.equal(closed, false);
        assert.equal(calls.length, 0);
        assert.equal(state.run.stopped, false);
        assert.equal(state.run.closing, "until reached");
    });
    test("openRun clears the logged-out personas of the run before", async () => {
        const state = emptyState();
        state.run.started = "2026-10-23T10:00:00.000Z";
        state.run.notionPage = "page-1";
        state.run.loggedOut = {builder: {since: "2026-10-23T11:00:00.000Z"}};
        await openRun(state, {repo: "tjlytle/Sozi"}, {}, () => {}, {
            run: async () => ({code: 1, stdout: "", stderr: ""}),
            startMint: async () => /** @type {any} */ ({port: 7311, close: async () => {}})
        });
        assert.deepEqual(state.run.loggedOut, {});
    });
});
