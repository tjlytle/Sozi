import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..", "..");

/** Run Cucumber on the failing fixture feature and read back its message stream.
 *
 * A config of its own keeps the default profile's HTML report untouched.
 *
 * @returns {{code: ?number, output: string, messages: any[]}} - The exit code, the
 *     console output and the parsed envelopes.
 */
function runFailingFeature() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-world-"));
    try {
        const out = path.join(dir, "out.ndjson");
        const config = path.join(dir, "cucumber.json");
        fs.writeFileSync(
            config,
            JSON.stringify({
                default: {
                    paths: ["test/fixtures/features/fails.feature"],
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

test("a failing browser scenario fails in its own step and gets a screenshot", () => {
    const {code, output, messages} = runFailingFeature();
    assert.notEqual(code, 0, output);

    const steps = new Map();
    for (const {testCase} of messages.filter(m => m.testCase)) {
        for (const step of testCase.testSteps) {
            steps.set(step.id, step);
        }
    }
    const failed = messages
        .filter(m => m.testStepFinished?.testStepResult.status === "FAILED")
        .map(m => steps.get(m.testStepFinished.testStepId));
    assert.equal(failed.length, 1, output);
    assert.ok(failed[0].pickleStepId, `a hook failed, not the fixture's step:\n${output}`);

    const screenshots = messages.filter(m => m.attachment?.mediaType === "image/png");
    assert.equal(screenshots.length, 1, output);
});
