/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests of the PreToolUse hook that blocks GitHub writes to the upstream
// repository. They spawn bash on the hook with a JSON payload on stdin.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const path = require("node:path");

const hook = path.resolve(__dirname, "..", "..", ".claude", "hooks", "no-upstream-writes.sh");

// Built here so that the commands that run these tests never contain it.
const UPSTREAM = ["sozi-projects", "Sozi"].join("/");

/** Run the hook on a raw stdin payload.
 *
 * @returns {"allow"|"deny"} - The decision of the hook.
 */
function decide(payload) {
    const result = spawnSync("bash", [hook], {input: payload, encoding: "utf8", timeout: 10000});
    assert.equal(result.status, 0, result.stderr);
    if (result.stdout.trim() === "") {
        return "allow";
    }
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    return "deny";
}

/** Run the hook on a Bash tool call with the given command. */
function decideCommand(command) {
    return decide(JSON.stringify({tool_name: "Bash", tool_input: {command}}));
}

describe("no-upstream-writes hook", () => {
    for (const [command, expected] of [
        [`gh issue list -R ${UPSTREAM}`, "allow"],
        [`gh issue view 585 -R ${UPSTREAM}`, "allow"],
        [`gh-as - api repos/${UPSTREAM}/pulls/759`, "allow"],
        ["gh issue create -R tjlytle/Sozi --title x", "allow"],
        [`gh-as advocate issue create -R ${UPSTREAM} --title x`, "deny"],
        [`gh api -X POST repos/${UPSTREAM}/issues`, "deny"],
        [`git push https://github.com/${UPSTREAM}.git master`, "deny"],
        [`gh issue create -R ${UPSTREAM.toUpperCase()} --title x`, "deny"],
        [`gh pr comment 759 -R ${UPSTREAM.replace("projects", "Projects")} --body x`, "deny"],
        [`gh-as builder api --method PATCH repos/${UPSTREAM}/issues/1`, "deny"],
        [`gh-as builder --git push https://github.com/${UPSTREAM}.git master`, "deny"],
        [`gh-as builder --push https://github.com/${UPSTREAM}.git master`, "deny"],
        [`gh api repos/${UPSTREAM}/pulls/759`, "allow"],
        [`gh api repos/${UPSTREAM}/issues -f title=x`, "deny"],
        [`gh-as builder api repos/${UPSTREAM}/issues/1/comments -F body=x`, "deny"],
        [`gh api repos/${UPSTREAM}/issues --field=title=x`, "deny"],
        [`gh api repos/${UPSTREAM}/issues --raw-field title=x`, "deny"],
        [`gh api repos/${UPSTREAM}/issues --input body.json`, "deny"]
    ]) {
        test(`${expected === "deny" ? "denies" : "allows"}: ${command}`, () => {
            assert.equal(decideCommand(command), expected);
        });
    }

    test("denies an invalid JSON payload", () => {
        assert.equal(decide("{not json"), "deny");
    });

    test("denies with a reason when jq is missing", () => {
        const result = spawnSync("/bin/bash", [hook], {
            input: JSON.stringify({tool_input: {command: "ls"}}),
            encoding: "utf8",
            env: {PATH: "/nonexistent"}
        });
        assert.equal(result.status, 0, result.stderr);
        const output = JSON.parse(result.stdout);
        assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
        assert.match(output.hookSpecificOutput.permissionDecisionReason, /hook could not parse the command/);
    });
});
