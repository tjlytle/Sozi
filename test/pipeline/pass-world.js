// test/pipeline/pass-world.js: the fakes the pass tests run a pass over.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createPass} from "../../pipeline/lib/pass.js";
import {emptyState, applyIssue} from "../../pipeline/lib/state.js";
import {loadConfig} from "../../pipeline/lib/config.js";
import {PERSONAS} from "../../pipeline/lib/profile.js";

/**
 * A logged-in profile with no MCP servers.
 *
 * @returns {any} - The profile info.
 */
export function loggedIn() {
    return {
        claude: {present: true, loggedIn: true, servers: []},
        codex: {present: false, loggedIn: false},
        writable: true
    };
}

/**
 * A fake GitHub that serves the given issues and labels from the state, and records each
 * write in calls.
 *
 * @param {any} state - The pass state; labelsOf reads an issue's labels from it.
 * @param {any[]} issues - What searchIssues returns.
 * @param {any[]} calls - Where the writes are recorded.
 * @returns {any} - A plain object; tests replace its methods after world() returns.
 */
function fakeGithub(state, issues, calls) {
    return {
        searchIssues: async () => issues,
        labelsOf: async (/** @type {number} */ n) => {
            calls.push(["labelsOf", n]);
            return state.issues[n].labels;
        },
        label: async (/** @type {any} */ op) => calls.push(["label", op]),
        comment: async (/** @type {any[]} */ ...a) => calls.push(["comment", ...a]),
        planComment: async () => null,
        lastCommentIsHuman: async () => false,
        lastHumanCommentAt: async () => /** @type {string | null} */ (null),
        openPrFor: async () => null,
        parentOf: async () => /** @type {number | null} */ (null),
        linkSubIssue: async (/** @type {number[]} */ ...a) => calls.push(["linkSubIssue", ...a]),
        unlinkSubIssue: async (/** @type {number[]} */ ...a) => calls.push(["unlinkSubIssue", ...a])
    };
}

/**
 * A fake sandbox whose containers live in a record: start marks one running, stop marks it
 * exited, and each start and outbox is recorded.
 *
 * @param {{containers: Record<string, string>, calls: any[], outboxes: any[], starts: any[], profiles: Record<string, any>}} records - The records it reads and writes; profiles answers inspectProfile.
 * @returns {any} - A plain object; tests replace its methods after world() returns.
 */
function fakeSandbox({containers, calls, outboxes, starts, profiles}) {
    return {
        refreshMirror: async () => {},
        prepareOutbox: (/** @type {any} */ o) => {
            outboxes.push(o);
            return fs.mkdtempSync(path.join(os.tmpdir(), "ob-"));
        },
        start: async (/** @type {any} */ o) => {
            const id = `c${o.issue}`;
            containers[id] = "running";
            calls.push(["start", o.issue, o.stage]);
            starts.push(o);
            return id;
        },
        inspectProfile: async (/** @type {string} */ persona) => profiles[persona] ?? null,
        status: async (/** @type {string} */ id) => containers[id] ?? "gone",
        stop: async (/** @type {string} */ id) => {
            containers[id] = "exited";
        },
        remove: async () => {}
    };
}

/**
 * A fake advisor that answers nothing and records each question it is asked in `asks`.
 *
 * @returns {{asks: any[], ask: (job: any) => Promise<void>, dispose: () => Promise<void>}} - The advisor.
 */
function fakeAdvisor() {
    /** @type {any[]} */
    const asks = [];
    return {
        asks,
        ask: async job => void asks.push(job),
        dispose: async () => {}
    };
}

/**
 * @typedef {object} Records
 * @property {any[]} calls - The fake GitHub's writes and the sandbox's starts, in order.
 * @property {Record<string, string>} containers - Each container's status, by id.
 * @property {string[]} logs - The pass's log lines.
 * @property {any[]} outboxes - What each prepareOutbox call was given.
 * @property {any[]} starts - What each sandbox start was given.
 * @property {Record<string, any>} profiles - What inspectProfile answers, by persona.
 */

/**
 * The records the fakes write and the tests read: empty, with every persona logged in.
 *
 * @returns {Records} - The records.
 */
function emptyRecords() {
    return {
        calls: [],
        containers: {},
        logs: [],
        outboxes: [],
        starts: [],
        profiles: Object.fromEntries(PERSONAS.map(p => [p, loggedIn()]))
    };
}

/**
 * A fake clock that starts at now and moves only when a test advances it.
 *
 * @param {number} now - The starting time in milliseconds.
 * @returns {{now: () => number, advance: (ms: number) => void}} - The clock.
 */
function fakeClock(now) {
    let current = now;
    return {
        now: () => current,
        advance: ms => {
            current += ms;
        }
    };
}

/**
 * A pass over fakes. Its advisor answers nothing; it records each question in `asks`.
 *
 * @param {{issues?: any[], now?: number, env?: Record<string, string>, save?: (state: any) => void, configRoot?: string, reload?: () => void}} [options] - The world; configRoot is where the settings files are read.
 * @returns {any} - The pass, the state, the fakes, the records they write (`Records`) and `asks`.
 */
export function world({
    issues = [],
    now = Date.parse("2026-10-21T19:00:00Z"),
    env = {},
    save = () => {},
    configRoot = "/nonexistent",
    reload
} = {}) {
    const settings = loadConfig({root: configRoot, env});
    const state = emptyState();
    state.run.started = new Date(now).toISOString();
    for (const i of issues) {
        applyIssue(state, i);
    }
    const records = emptyRecords();
    const github = fakeGithub(state, issues, records.calls);
    const sandbox = fakeSandbox(records);
    /** @type {any} */
    const board = {sync: async () => ({failed: []})};
    const digest = {add: async () => {}, finish: async () => {}};
    const clock = fakeClock(now);
    const advisor = fakeAdvisor();
    const p = createPass({
        advisor,
        settings,
        state,
        github,
        sandbox,
        board,
        digest,
        clock,
        env,
        log: line => records.logs.push(line),
        save: () => save(state),
        reload
    });
    return {
        ...records,
        p,
        state,
        clock,
        github,
        issues,
        settings,
        board,
        sandbox,
        asks: advisor.asks
    };
}

/**
 * An open issue as `searchIssues` returns it.
 *
 * @param {number} number - The issue number; the title is built from it.
 * @param {string[]} labels - The issue's labels.
 * @param {any} [extra] - Fields that replace or add to the defaults.
 * @returns {any} - The issue.
 */
export function issue(number, labels, extra = {}) {
    return {
        number,
        title: `t${number}`,
        labels,
        state: "OPEN",
        body: "",
        updatedAt: "2026-10-21T00:00:00Z",
        ...extra
    };
}

/**
 * Write a session's result and requests into its outbox and end its container.
 *
 * @param {any} w - The world.
 * @param {string} outbox - The outbox.
 * @param {string} container - The container id.
 * @param {{exit?: number, hooks?: string, status?: string, usage?: Record<string, any> | null, resumes?: number, requests?: Record<string, any>, carry?: string}} [result] - What the session left; usage replaces some usage fields, or is null for a session without usage.json; carry "failed" when its carried work did not apply.
 */
export function end(
    w,
    outbox,
    container,
    {exit = 0, hooks = "ok", status = "ok", usage = {}, resumes = 0, requests = {}, carry} = {}
) {
    fs.writeFileSync(
        path.join(outbox, "result.json"),
        JSON.stringify({
            exit,
            session: "s",
            usage:
                usage === null
                    ? null
                    : {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 1, status, ...usage},
            changed: [],
            commits: [],
            resumes,
            hooks,
            carry
        })
    );
    for (const [name, body] of Object.entries(requests)) {
        fs.writeFileSync(path.join(outbox, `req-${name}.json`), JSON.stringify(body));
    }
    w.containers[container] = "exited";
}
