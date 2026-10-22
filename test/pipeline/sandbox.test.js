// test/pipeline/sandbox.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createSandbox} from "../../pipeline/lib/sandbox.js";
import {loadConfig} from "../../pipeline/lib/config.js";

describe("sandbox", () => {
    const settings = loadConfig({
        root: "/nonexistent",
        env: {PIPELINE_MEMORY: "6g", PIPELINE_CPUS: "2"}
    });
    const sb = createSandbox({
        settings,
        root: "/repo",
        run: async () => ({code: 0, stdout: "", stderr: ""})
    });
    test("docker run arguments: mounts, limits, env by name, no values", () => {
        const args = sb.startArgs({
            issue: 25,
            stage: "build",
            outbox: "/repo/var/pipeline/out-25-build-1902",
            mintUrl: "http://host.docker.internal:7311/",
            mintKey: "k"
        });
        assert.equal(args[0], "run");
        assert.ok(args.includes("--memory") && args[args.indexOf("--memory") + 1] === "6g");
        assert.ok(args.includes("/repo/var/pipeline/mirror.git:/mirror:ro"));
        assert.ok(args.includes("/repo/var/pipeline/out-25-build-1902:/outbox"));
        assert.ok(args.includes("GH_MINT_URL=http://host.docker.internal:7311/"));
        assert.ok(args.includes("CLAUDE_CODE_OAUTH_TOKEN"), "passed by name only");
        assert.ok(!args.some(a => a.startsWith("CLAUDE_CODE_OAUTH_TOKEN=")));
        assert.deepEqual(
            args.slice(-3),
            ["sozi-factory", "/pipeline/stage.sh", "25", "build"].slice(-3)
        );
        assert.match(args[args.indexOf("--name") + 1], /^factory-25-build-/);
    });
    test("no limits when unset; the stage's harness and model by value", () => {
        const plain = createSandbox({
            settings: loadConfig({root: "/nonexistent", env: {}}),
            root: "/repo",
            run: async () => ({code: 0, stdout: "", stderr: ""})
        });
        const args = plain.startArgs({
            issue: 25,
            stage: "plan",
            outbox: "/o",
            mintUrl: "u",
            mintKey: "k"
        });
        assert.ok(!args.includes("--memory") && !args.includes("--cpus"));
        assert.ok(args.includes("PIPELINE_MODEL=claude-fable-5-1"));
        assert.ok(args.includes("PIPELINE_HARNESS=claude"));
        assert.ok(args.includes("--add-host=host.docker.internal:host-gateway"));
        assert.ok(args.includes("PIPELINE_ISSUE") && args.includes("NOTION_TOKEN"));
    });

    /**
     * A sandbox whose runner records commands and answers from a table.
     *
     * @param {(cmd: string[]) => {code: number, stdout?: string}} answer - The reply per command.
     * @param {string} [root] - The repository root.
     * @returns {{sb: any, calls: {cmd: string[], opts: any}[]}} - The sandbox and its calls.
     */
    function recording(answer, root = "/repo") {
        /** @type {{cmd: string[], opts: any}[]} */
        const calls = [];
        const run = async (/** @type {string[]} */ cmd, /** @type {any} */ opts) => {
            calls.push({cmd, opts});
            const a = answer(cmd);
            return {code: a.code, stdout: a.stdout ?? "", stderr: ""};
        };
        return {sb: createSandbox({settings, root, run}), calls};
    }

    test("status: running, exited, or gone when docker does not know it", async () => {
        const {sb: s} = recording(cmd =>
            cmd.at(-1) === "a"
                ? {code: 0, stdout: "running\n"}
                : cmd.at(-1) === "b"
                  ? {code: 0, stdout: "exited\n"}
                  : {code: 1}
        );
        assert.equal(await s.status("a"), "running");
        assert.equal(await s.status("b"), "exited");
        assert.equal(await s.status("c"), "gone");
    });
    test("start passes credentials through the environment and returns the id", async () => {
        const {sb: s, calls} = recording(() => ({code: 0, stdout: "abc123\n"}));
        const id = await s.start({
            issue: 25,
            stage: "build",
            outbox: "/o",
            mintUrl: "u",
            mintKey: "k",
            env: {PIPELINE_ISSUE: "25"}
        });
        assert.equal(id, "abc123");
        assert.equal(calls[0].cmd[0], "docker");
        assert.equal(calls[0].opts.env.PIPELINE_ISSUE, "25");
    });
    test("refreshMirror clones once, then updates", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-"));
        const {sb: s, calls} = recording(() => ({code: 0}), root);
        await s.refreshMirror();
        assert.deepEqual(calls[0].cmd.slice(0, 3), ["git", "clone", "--mirror"]);
        fs.mkdirSync(path.join(root, "var", "pipeline", "mirror.git"), {recursive: true});
        await s.refreshMirror();
        assert.deepEqual(calls[1].cmd.slice(-3), ["remote", "update", "--prune"]);
    });
    test("prepareOutbox writes the prompt and the allow list in a fresh directory", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-"));
        const {sb: s} = recording(() => ({code: 0}), root);
        const a = s.prepareOutbox({issue: 25, stage: "build", prompt: "P", allow: "Read\n"});
        const b = s.prepareOutbox({issue: 25, stage: "build", prompt: "Q", allow: "Read\n"});
        assert.notEqual(a, b);
        assert.match(path.basename(a), /^out-25-build-/);
        assert.equal(fs.readFileSync(path.join(a, "prompt.md"), "utf8"), "P");
        assert.equal(fs.readFileSync(path.join(b, "allow.txt"), "utf8"), "Read\n");
    });
});
