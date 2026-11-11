// test/pipeline/sandbox-args.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {createSandbox} from "../../pipeline/lib/sandbox.js";
import {loadConfig} from "../../pipeline/lib/config.js";
import {recording} from "./sandbox-world.js";

describe("sandbox: arguments", () => {
    const {sb} = recording(() => ({code: 0}));
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
        assert.equal(args[args.indexOf("--shm-size") + 1], "2g");
        assert.ok(args.includes("/repo/var/pipeline/mirror.git:/mirror:ro"));
        assert.ok(args.includes("/repo/var/pipeline/out-25-build-1902:/outbox"));
        assert.ok(args.includes("GH_MINT_URL=http://host.docker.internal:7311/"));
        assert.ok(args.includes("CLAUDE_CODE_OAUTH_TOKEN"), "passed by name only");
        assert.ok(!args.some(a => a.startsWith("CLAUDE_CODE_OAUTH_TOKEN=")));
        assert.ok(args.includes("GH_MINT_KEY"), "the mint key by name too");
        assert.ok(!args.some(a => a.startsWith("GH_MINT_KEY=")));
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
        assert.equal(args[args.indexOf("--shm-size") + 1], "1g", "a 1g /dev/shm by default");
        assert.ok(args.includes("PIPELINE_MODEL=claude-fable-5-1"));
        assert.ok(args.includes("PIPELINE_HARNESS=claude"));
        assert.ok(args.includes("--add-host=host.docker.internal:host-gateway"));
        assert.ok(args.includes("PIPELINE_ISSUE") && args.includes("NOTION_TOKEN"));
    });
    test("an empty PIPELINE_SHM_SIZE leaves Docker's /dev/shm default", () => {
        const plain = createSandbox({
            settings: loadConfig({root: "/nonexistent", env: {PIPELINE_SHM_SIZE: ""}}),
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
        assert.ok(!args.includes("--shm-size"));
    });
    test("the profile volume and the harness config dirs when profile is set", () => {
        const args = sb.startArgs({
            issue: 25,
            stage: "build",
            persona: "builder",
            profile: true,
            outbox: "/o",
            mintUrl: "u",
            mintKey: "k"
        });
        assert.ok(args.includes("sozi-factory-profile-builder:/profile"));
        assert.ok(args.includes("CLAUDE_CONFIG_DIR=/profile/claude"));
        assert.ok(args.indexOf("sozi-factory") > args.indexOf("CLAUDE_CONFIG_DIR=/profile/claude"));
    });
    test("a profiled start names no fallback token; an unprofiled one names both", () => {
        const base = {issue: 25, stage: "build", persona: "builder", outbox: "/o", mintUrl: "u"};
        const profiled = sb.startArgs({...base, mintKey: "k", profile: true});
        const plain = sb.startArgs({...base, mintKey: "k"});
        for (const name of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]) {
            assert.ok(!profiled.includes(name), name);
            assert.equal(plain[plain.indexOf(name) - 1], "-e", name);
        }
        assert.ok(profiled.includes("NOTION_TOKEN"));
    });
    test("no profile arguments when profile is not set", () => {
        const args = sb.startArgs({
            issue: 25,
            stage: "build",
            persona: "builder",
            outbox: "/o",
            mintUrl: "u",
            mintKey: "k"
        });
        assert.ok(!args.some(a => a.includes("/profile")));
    });
    test("startArgs passes the session to resume as PIPELINE_RESUME_SESSION", () => {
        const base = {issue: 25, stage: "build", outbox: "/o", mintUrl: "u", mintKey: "k"};
        const args = sb.startArgs({...base, resume: {session: "abc-123", carryFrom: "/old"}});
        assert.equal(args[args.indexOf("PIPELINE_RESUME_SESSION=abc-123") - 1], "-e");
        assert.ok(!sb.startArgs(base).some(a => a.startsWith("PIPELINE_RESUME_SESSION")));
    });
    test("startArgs passes the persona by value as PIPELINE_PERSONA", () => {
        const base = {issue: 25, stage: "build", outbox: "/o", mintUrl: "u", mintKey: "k"};
        const args = sb.startArgs({...base, persona: "architect"});
        assert.equal(args[args.indexOf("PIPELINE_PERSONA=architect") - 1], "-e");
        assert.ok(!sb.startArgs(base).some(a => a.startsWith("PIPELINE_PERSONA")));
    });
});
