// test/pipeline/sandbox.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createSandbox} from "../../pipeline/lib/sandbox.js";
import {recording, sandboxSettings} from "./sandbox-world.js";

describe("sandbox", () => {
    const settings = sandboxSettings();
    test("status: running, exited, gone when docker does not know it, unknown when docker fails", async () => {
        /** @type {Record<string, {code: number, stdout?: string, stderr?: string}>} */
        const replies = {
            a: {code: 0, stdout: "running\n"},
            b: {code: 0, stdout: "exited\n"},
            c: {code: 1, stderr: "Error: No such object: c\n"},
            d: {
                code: 1,
                stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock\n"
            }
        };
        const {sb: s} = recording(cmd => replies[/** @type {string} */ (cmd.at(-1))]);
        assert.equal(await s.status("a"), "running");
        assert.equal(await s.status("b"), "exited");
        assert.equal(await s.status("c"), "gone");
        assert.equal(await s.status("d"), "unknown");
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
        assert.equal(calls[0].opts.env.GH_MINT_KEY, "k");
    });
    test("start hands docker the secrets of the loop's environment, by name", async () => {
        /** @type {any[]} */
        const calls = [];
        const s = createSandbox({
            settings,
            root: "/repo",
            env: {CLAUDE_CODE_OAUTH_TOKEN: "tok", NOTION_TOKEN: "n", UNRELATED: "x"},
            run: async (cmd, opts) => {
                calls.push({cmd, opts});
                return {code: 0, stdout: "id\n", stderr: ""};
            }
        });
        await s.start({issue: 25, stage: "build", outbox: "/o", mintUrl: "u", mintKey: "k"});
        assert.equal(calls[0].opts.env.CLAUDE_CODE_OAUTH_TOKEN, "tok");
        assert.equal(calls[0].opts.env.NOTION_TOKEN, "n");
        assert.equal(calls[0].opts.env.UNRELATED, undefined, "only the names docker passes");
        assert.ok(!calls[0].cmd.some((/** @type {string} */ a) => a.includes("tok")));
    });
    test("a profiled start leaves the fallback tokens out; an unprofiled one keeps them", async () => {
        /** @type {any[]} */
        const calls = [];
        const s = createSandbox({
            settings,
            root: "/repo",
            env: {CLAUDE_CODE_OAUTH_TOKEN: "tok", ANTHROPIC_API_KEY: "key", NOTION_TOKEN: "n"},
            run: async (cmd, opts) => {
                calls.push({cmd, opts});
                return {code: 0, stdout: "id\n", stderr: ""};
            }
        });
        const base = {issue: 25, stage: "build", outbox: "/o", mintUrl: "u", mintKey: "k"};
        await s.start({...base, persona: "builder", profile: true});
        await s.start(base);
        assert.equal(calls[0].opts.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
        assert.equal(calls[0].opts.env.ANTHROPIC_API_KEY, undefined);
        assert.equal(calls[0].opts.env.NOTION_TOKEN, "n");
        assert.equal(calls[1].opts.env.CLAUDE_CODE_OAUTH_TOKEN, "tok");
        assert.equal(calls[1].opts.env.ANTHROPIC_API_KEY, "key");
    });
    test("buildImage builds from the repo root alone, no named context", async () => {
        const {sb: s, calls} = recording(() => ({code: 0}));
        await s.buildImage();
        const cmd = calls[0].cmd;
        assert.deepEqual(cmd.slice(0, 3), ["docker", "build", "-t"]);
        assert.ok(!cmd.includes("--build-context"));
        assert.equal(
            cmd[cmd.indexOf("--build-arg") + 1],
            `FACTORY_UID=${process.getuid?.() ?? 1000}`
        );
        assert.equal(cmd[cmd.indexOf("-f") + 1], "/repo/docker/factory/Dockerfile");
        assert.equal(cmd.at(-1), "/repo");
    });
    test("refreshMirror clones once, then updates", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-"));
        const {sb: s, calls} = recording(() => ({code: 0}), root);
        await s.refreshMirror();
        assert.deepEqual(calls[0].cmd.slice(0, 3), ["git", "clone", "--mirror"]);
        fs.mkdirSync(path.join(root, "var", "pipeline", "mirror.git"), {recursive: true});
        await s.refreshMirror();
        assert.deepEqual(calls[1].cmd.slice(-3), ["remote", "update", "--prune"]);
        assert.deepEqual(calls[1].cmd.slice(0, 3), ["git", "-c", "gc.auto=0"]);
    });
});
