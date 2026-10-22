// test/pipeline/pass-world.js: the fakes the pass tests run a pass over.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createPass} from "../../pipeline/lib/pass.js";
import {emptyState, applyIssue} from "../../pipeline/lib/state.js";
import {loadConfig} from "../../pipeline/lib/config.js";

/**
 * A pass over fakes.
 *
 * @param {{issues?: any[], now?: number, env?: Record<string, string>}} [options] - The world.
 * @returns {any} - The pass, the state, the recorded calls and the fakes.
 */
export function world({issues = [], now = Date.parse("2026-10-21T19:00:00Z"), env = {}} = {}) {
    const settings = loadConfig({root: "/nonexistent", env});
    const state = emptyState();
    state.run.started = new Date(now).toISOString();
    for (const i of issues) {
        applyIssue(state, i);
    }
    /** @type {any[]} */
    const calls = [];
    /** @type {Record<string, string>} */
    const containers = {};
    /** @type {string[]} */
    const logs = [];
    /** @type {any[]} */
    const outboxes = [];
    const github = {
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
        openPrFor: async () => null
    };
    const sandbox = {
        refreshMirror: async () => {},
        prepareOutbox: (/** @type {any} */ o) => {
            outboxes.push(o);
            return fs.mkdtempSync(path.join(os.tmpdir(), "ob-"));
        },
        start: async (/** @type {any} */ o) => {
            const id = `c${o.issue}`;
            containers[id] = "running";
            calls.push(["start", o.issue, o.stage]);
            return id;
        },
        status: async (/** @type {string} */ id) => containers[id] ?? "gone",
        stop: async (/** @type {string} */ id) => {
            containers[id] = "exited";
        },
        remove: async () => {}
    };
    const board = {sync: async () => {}};
    const digest = {add: async () => {}, finish: async () => {}};
    let current = now;
    const clock = {
        now: () => current,
        advance: (/** @type {number} */ ms) => {
            current += ms;
        }
    };
    const p = createPass({
        settings,
        state,
        github: /** @type {any} */ (github),
        sandbox,
        board,
        digest,
        clock,
        log: line => logs.push(line)
    });
    return {p, state, calls, containers, clock, logs, outboxes, github, issues, settings};
}
export const issue = (
    /** @type {number} */ number,
    /** @type {string[]} */ labels,
    /** @type {any} */ extra = {}
) => ({
    number,
    title: `t${number}`,
    labels,
    state: "OPEN",
    body: "",
    updatedAt: "2026-10-21T00:00:00Z",
    ...extra
});

/**
 * Write a session's result and requests into its outbox and end its container.
 *
 * @param {any} w - The world.
 * @param {string} outbox - The outbox.
 * @param {string} container - The container id.
 * @param {{exit?: number, hooks?: string, requests?: Record<string, any>}} [result] - What the session left.
 */
export function end(w, outbox, container, {exit = 0, hooks = "ok", requests = {}} = {}) {
    fs.writeFileSync(
        path.join(outbox, "result.json"),
        JSON.stringify({
            exit,
            session: "s",
            usage: {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 1, status: "ok"},
            changed: [],
            commits: [],
            resumes: 0,
            hooks
        })
    );
    for (const [name, body] of Object.entries(requests)) {
        fs.writeFileSync(path.join(outbox, `req-${name}.json`), JSON.stringify(body));
    }
    w.containers[container] = "exited";
}
