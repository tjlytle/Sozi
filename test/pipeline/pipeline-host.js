// test/pipeline/pipeline-host.js: the fakes the bin/pipeline.js tests run main() over.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {emptyState} from "../../pipeline/lib/state.js";
import {loggedIn} from "./pass-world.js";

const REPO = path.resolve(import.meta.dirname, "..", "..");

/**
 * A repository root with the prompts, and fakes for everything outside the loop.
 *
 * @param {{statuses: string[], onSleep?: (calls: number) => void}} options - The container
 *     states the fake docker reports in turn, and a hook on each wait.
 * @returns {any} - The root, the recorded events, the fakes and the captured handler.
 */
export function host({statuses, onSleep = () => {}}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pl-"));
    fs.mkdirSync(path.join(root, "pipeline"));
    for (const f of ["plan.md", "allow.txt"]) {
        fs.copyFileSync(path.join(REPO, "pipeline", f), path.join(root, "pipeline", f));
    }
    /** @type {string[]} */
    const events = [];
    const h = {root, events, handler: () => {}, exits: /** @type {number[]} */ ([])};
    let sleeps = 0;
    const issues = [{...issue(25, ["stage:todo"])}];
    const silent = async () => {};
    h.deps = {
        run: async () => ({code: 1, stdout: "", stderr: ""}),
        startMint: async () => ({
            url: "u",
            port: 7311,
            close: async () => void events.push("close")
        }),
        github: {
            searchIssues: async () => issues,
            labelsOf: async () => ["stage:todo"],
            label: silent,
            comment: silent,
            planComment: async () => null,
            lastCommentIsHuman: async () => false,
            lastHumanCommentAt: async () => null,
            openPrFor: async () => null
        },
        board: {sync: silent},
        sandbox: {
            refreshMirror: silent,
            prepareOutbox: () => fs.mkdtempSync(path.join(os.tmpdir(), "ob-")),
            start: async () => "c25",
            status: async () => statuses.shift() ?? "exited",
            stop: silent,
            remove: async () => void events.push("remove"),
            inspectProfile: async () => loggedIn()
        },
        sleep: async () => onSleep(++sleeps),
        onSignal: (/** @type {() => void} */ handler) => {
            h.handler = handler;
            return () => {};
        },
        exit: (/** @type {number} */ code) => void h.exits.push(code)
    };
    return h;
}

/**
 * Write a state file under a root.
 *
 * @param {string} root - The repository root.
 * @param {any} state - The state.
 * @returns {string} - The state file.
 */
export function writeState(root, state) {
    fs.mkdirSync(path.join(root, "var", "pipeline"), {recursive: true});
    const file = path.join(root, "var", "pipeline", "state.json");
    fs.writeFileSync(file, JSON.stringify(state));
    return file;
}

/**
 * A run in progress: started, with a page, totals and a mint key.
 *
 * @returns {any} - The state.
 */
export function runningState() {
    const state = emptyState();
    state.run.started = "2026-10-21T19:00:00Z";
    state.run.notionPage = "page-1";
    state.run.tokens = 1234;
    state.run.costUsd = 5;
    state.run.mintKey = "old-key";
    return state;
}

/**
 * An open issue with the given labels, as the GitHub search returns it.
 *
 * @param {number} number - The issue number.
 * @param {string[]} labels - Its labels.
 * @returns {any} - The issue.
 */
export function issue(number, labels) {
    return {
        number,
        title: `t${number}`,
        labels,
        state: /** @type {"OPEN"} */ ("OPEN"),
        body: "",
        updatedAt: "2026-10-21T00:00:00Z"
    };
}
