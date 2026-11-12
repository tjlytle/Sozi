/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The GitHub Actions run calls the loop makes, as ops, which has Actions rights. Kept apart
// from github.js, whose calls are about issues; createGithub spreads these into its client.

const RUN_FIELDS = "databaseId,status,conclusion,createdAt,headBranch,jobs";

/**
 * @typedef {object} Run
 * @property {number} databaseId - The run id.
 * @property {string} status - queued, in_progress, completed and the like.
 * @property {string} [conclusion] - How a completed run ended.
 * @property {string} createdAt - ISO time the run was created.
 * @property {string} [headBranch] - The branch it runs on.
 * @property {unknown[]} [jobs] - Its jobs; none while GitHub has not started it.
 */

/**
 * @typedef {object} RunsClient
 * @property {(id: number) => Promise<Run>} runView - One run, with its branch and jobs.
 * @property {() => Promise<Run[]>} recentRuns - The newest 30 runs in the repository.
 * @property {(id: number) => Promise<void>} cancelRun - Cancel a run.
 * @property {(id: number) => Promise<void>} rerunRun - Rerun a finished run.
 */

/**
 * Make the Actions run calls over the GitHub client's runners.
 *
 * @param {object} options - What the calls run through.
 * @param {string} options.repo - The repository, owner/name.
 * @param {(cmd: string[]) => Promise<string>} options.exec - Runs a command; throws on failure.
 * @param {(cmd: string[]) => Promise<any>} options.json - Runs a command and parses its output.
 * @returns {RunsClient} The calls.
 */
export function runsClient({repo, exec, json}) {
    return {
        runView: id =>
            json(["gh-as", "ops", "run", "view", String(id), "-R", repo, "--json", RUN_FIELDS]),
        recentRuns: () =>
            json([
                "gh-as",
                "ops",
                "run",
                "list",
                "-R",
                repo,
                "--limit",
                "30",
                "--json",
                "databaseId,status,createdAt"
            ]),
        async cancelRun(id) {
            await exec(["gh-as", "ops", "run", "cancel", String(id), "-R", repo]);
        },
        async rerunRun(id) {
            await exec(["gh-as", "ops", "run", "rerun", String(id), "-R", repo]);
        }
    };
}
