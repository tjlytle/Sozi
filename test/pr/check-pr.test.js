/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests of the pull request shape check (code-standard.md 5).

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {closedIssues, issueOfBranch, noiseIn, problems} from "../../bin/check-pr.js";

describe("PR shape", () => {
    test("branch names carry their issue", () => {
        assert.equal(issueOfBranch("25-protocol-transport"), 25);
        assert.equal(issueOfBranch("2-render-export"), 2);
        assert.equal(issueOfBranch("software-factory"), null);
        assert.equal(issueOfBranch("25_protocol"), null);
        assert.equal(issueOfBranch("25-Protocol"), null);
    });
    test("bodies close issues in the usual phrasings", () => {
        assert.deepEqual(closedIssues("Closes #25"), [25]);
        assert.deepEqual(closedIssues("fixes #3 and resolves tjlytle/Sozi#4"), [3, 4]);
        assert.deepEqual(closedIssues("See #7 for context"), []);
    });
    test("build noise is spotted among changed paths", () => {
        assert.deepEqual(
            noiseIn(["src/js/a.js", "yarn.lock", "locales/messages.pot", "locales/fr.po"]),
            ["yarn.lock", "locales/messages.pot"]
        );
    });
    test("a well-shaped PR has no problems", () => {
        assert.deepEqual(
            problems({
                branch: "25-protocol",
                body: "Closes #25\n\nPlan: as written.",
                changed: ["src/js/protocol/messages.ts"]
            }),
            []
        );
    });
    test("each defect is named", () => {
        const found = problems({branch: "fix-stuff", body: "Closes #25", changed: ["yarn.lock"]});
        assert.equal(found.length, 2);
        assert.match(found[0], /not <issue number>-<slug>/);
        assert.match(found[1], /yarn.lock is build noise/);
        assert.match(
            problems({branch: "25-protocol", body: "Closes #26", changed: []})[0],
            /branch is for #25 but the body closes #26/
        );
        assert.match(
            problems({branch: "25-protocol", body: "No issue.", changed: []})[0],
            /does not close an issue/
        );
    });
    test("an unknown body skips the body checks", () => {
        assert.deepEqual(problems({branch: "25-protocol", body: null, changed: []}), []);
    });
});
