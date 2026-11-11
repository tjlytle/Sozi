import {test} from "node:test";
import assert from "node:assert/strict";
import {failedSteps, runFailingFeature} from "./cucumber.js";

test("a failing editor scenario fails in its own step and gets a screenshot", () => {
    const {code, output, messages} = runFailingFeature(
        "test/fixtures/features/editor-fails.feature"
    );
    assert.notEqual(code, 0, output);

    const failed = failedSteps(messages);
    assert.equal(failed.length, 1, output);
    assert.ok(failed[0].pickleStepId, `a hook failed, not the fixture's step:\n${output}`);

    const screenshots = messages.filter(m => m.attachment?.mediaType === "image/png");
    assert.equal(screenshots.length, 1, output);
});
