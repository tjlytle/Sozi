/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests of .github/workflows/ci.yml: an artifact upload in the build job may fail
// without failing the job, and a test step may not.

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const WORKFLOW = readFileSync(".github/workflows/ci.yml", "utf8");

/** The steps of one job, each as the text of its `- ` entry.
 *
 * Plain text scanning: the workflow keeps its jobs at four spaces and its steps at
 * twelve, so a step runs from one `            - ` line to the next.
 *
 * @param {string} job - The job's key under `jobs:`.
 * @returns {string[]} - The text of each step.
 */
function stepsOf(job) {
    const lines = WORKFLOW.split("\n");
    const start = lines.indexOf(`    ${job}:`);
    assert.notEqual(start, -1, `no job ${job} in ci.yml`);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex(line => /^ {4}\S/.test(line));
    const body = end === -1 ? rest : rest.slice(0, end);
    const steps = [];
    for (const line of body) {
        if (/^ {12}- /.test(line)) {
            steps.push(line);
        } else if (steps.length > 0 && !/^ {12}#/.test(line)) {
            steps[steps.length - 1] += `\n${line}`;
        }
    }
    return steps;
}

const BUILD = stepsOf("build");

describe("ci.yml build job", () => {
    test("has upload and test steps to check", () => {
        assert.ok(BUILD.some(step => /uses: actions\/upload-artifact/.test(step)));
        assert.ok(BUILD.some(step => /run: .*npm test/.test(step)));
    });

    test("lets every artifact upload fail without failing the job", () => {
        const strict = BUILD.filter(
            step =>
                /uses: actions\/upload-artifact/.test(step) && !/continue-on-error: true/.test(step)
        ).map(step => step.split("\n")[0].trim());
        assert.deepEqual(strict, []);
    });

    test("fails the job when a test step fails", () => {
        const lenient = BUILD.filter(
            step =>
                /run: .*npm (test|run test:features)/.test(step) && /continue-on-error/.test(step)
        );
        assert.deepEqual(lenient, []);
    });
});
