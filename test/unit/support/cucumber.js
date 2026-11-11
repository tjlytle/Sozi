/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Runs a fixture feature through Cucumber, for the tests of the scenario hooks.

import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..", "..");

/** Run Cucumber on a fixture feature that fails on purpose and read back its message stream.
 *
 * A config of its own keeps the default profile's HTML report untouched.
 *
 * @param {string} feature - The feature file, relative to the repository root.
 * @returns {{code: ?number, output: string, messages: any[]}} - The exit code, the
 *     console output and the parsed envelopes.
 */
export function runFailingFeature(feature) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-cucumber-"));
    try {
        const out = path.join(dir, "out.ndjson");
        const config = path.join(dir, "cucumber.json");
        fs.writeFileSync(
            config,
            JSON.stringify({
                default: {
                    paths: [feature],
                    import: [
                        "test/features/support/**/*.js",
                        "test/features/steps/**/*.js",
                        "test/fixtures/features/fails.steps.js"
                    ],
                    format: [`message:${out}`],
                    publish: false
                }
            })
        );
        const run = spawnSync(
            path.join(root, "node_modules", ".bin", "cucumber-js"),
            // Relative: cucumber-js joins even an absolute config path onto its cwd.
            ["--config", path.relative(root, config)],
            {cwd: root, encoding: "utf8"}
        );
        assert.ok(fs.existsSync(out), `cucumber-js did not run:\n${run.stdout}${run.stderr}`);
        const messages = fs
            .readFileSync(out, "utf8")
            .split("\n")
            .filter(Boolean)
            .map(line => JSON.parse(line));
        return {code: run.status, output: run.stdout + run.stderr, messages};
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

/** The steps and hooks of a run that failed, from its message stream.
 *
 * @param {any[]} messages - The envelopes runFailingFeature returned.
 * @returns {any[]} - Each failed test step; a hook's has no pickleStepId.
 */
export function failedSteps(messages) {
    const steps = new Map();
    for (const {testCase} of messages.filter(m => m.testCase)) {
        for (const step of testCase.testSteps) {
            steps.set(step.id, step);
        }
    }
    return messages
        .filter(m => m.testStepFinished?.testStepResult.status === "FAILED")
        .map(m => steps.get(m.testStepFinished.testStepId));
}
