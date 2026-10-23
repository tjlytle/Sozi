// test/pipeline/run.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {emptyState} from "../../pipeline/lib/state.js";
import {finishDigest, openRun} from "../../pipeline/lib/run.js";

/**
 * Finish the digest of a run on page-1 with a digest command that exits with a code.
 *
 * @param {number} code - The exit status of the digest command.
 * @param {{notionPage?: string | null}} [run] - What to change on the run.
 * @returns {Promise<{finished: boolean, calls: string[][]}>} - The result and the commands.
 */
async function finish(code, {notionPage = "page-1"} = {}) {
    const state = emptyState();
    state.run.notionPage = notionPage;
    /** @type {string[][]} */
    const calls = [];
    const finished = await finishDigest({
        state,
        reason: "finished by hand",
        settings: {repo: "tjlytle/Sozi", evidence: {url: ""}},
        root: "/nowhere",
        env: {NOTION_TOKEN: "nt"},
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
    return {finished, calls};
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
