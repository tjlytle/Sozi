// test/pipeline/nudge.test.js: pipeline/nudge.sh prints the runner's nudge once, plain or as hook output.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {root} from "./harness-adapter.js";

/**
 * Run nudge.sh over an outbox.
 *
 * @param {string} outbox - The outbox.
 * @param {string[]} [args] - The arguments.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} The finished process.
 */
function nudge(outbox, args = []) {
    return spawnSync("bash", [path.join(root, "pipeline/nudge.sh"), ...args], {
        env: {PATH: process.env.PATH ?? "", OUTBOX: outbox},
        encoding: "utf8"
    });
}

/**
 * An outbox holding a nudge.
 *
 * @returns {string} The outbox.
 */
function withNudge() {
    const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "nudge-"));
    fs.writeFileSync(path.join(outbox, "nudge.md"), "you have spent 23 minutes on this\n");
    return outbox;
}

describe("nudge.sh", () => {
    test("prints the nudge once, then nothing", () => {
        const outbox = withNudge();
        const first = nudge(outbox);
        assert.equal(first.status, 0);
        assert.match(first.stdout, /you have spent 23 minutes on this/);
        assert.ok(fs.existsSync(path.join(outbox, "nudge.seen")));
        assert.ok(!fs.existsSync(path.join(outbox, "nudge.md")));
        const second = nudge(outbox);
        assert.equal(second.status, 0);
        assert.equal(second.stdout, "");
    });

    test("with --hook, prints the nudge as PostToolUse additional context", () => {
        const outbox = withNudge();
        const r = nudge(outbox, ["--hook"]);
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(JSON.parse(r.stdout), {
            hookSpecificOutput: {
                hookEventName: "PostToolUse",
                additionalContext: "you have spent 23 minutes on this"
            }
        });
        assert.equal(nudge(outbox, ["--hook"]).stdout, "");
    });

    test("with no outbox, prints nothing and succeeds", () => {
        const r = nudge("/nonexistent-outbox");
        assert.equal(r.status, 0);
        assert.equal(r.stdout, "");
    });
});
