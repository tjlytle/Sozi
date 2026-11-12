// test/pipeline/container-args.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {consultArgs, loginArgs, startArgs, startEnv} from "../../pipeline/lib/container-args.js";
import {sandboxSettings} from "./sandbox-world.js";

const BASE = {issue: 25, stage: "build", outbox: "/o", mintUrl: "u", mintKey: "k"};

describe("container arguments", () => {
    test("startArgs mounts the mirror and names the container from the time", () => {
        const at = new Date(Date.UTC(2026, 10, 12, 9, 5));
        const args = startArgs(sandboxSettings(), "/m.git", {...BASE, now: at, tag: "x"});
        assert.equal(args[args.indexOf("--name") + 1], "factory-25-build-0905-x");
        assert.ok(args.includes("/m.git:/mirror:ro"));
        assert.ok(args.includes("CLAUDE_CODE_OAUTH_TOKEN"));
        assert.deepEqual(args.slice(-4), ["sozi-factory", "/pipeline/stage.sh", "25", "build"]);
    });
    test("startArgs with a profile mounts it and passes no token name", () => {
        const args = startArgs(sandboxSettings(), "/m.git", {
            ...BASE,
            persona: "builder",
            profile: true
        });
        assert.ok(args.includes("sozi-factory-profile-builder:/profile"));
        assert.ok(args.includes("PIPELINE_PERSONA=builder"));
        assert.ok(!args.includes("CLAUDE_CODE_OAUTH_TOKEN"));
        assert.ok(!args.includes("ANTHROPIC_API_KEY"));
    });
    test("startEnv passes the secrets, the evidence settings, opts.env and the mint key", () => {
        const settings = sandboxSettings();
        settings.evidence = {account: "acc", bucket: "", token: "tok", url: "https://e"};
        const loopEnv = {CLAUDE_CODE_OAUTH_TOKEN: "t", NOTION_TOKEN: "n", OTHER: "o"};
        const env = startEnv(settings, loopEnv, {...BASE, env: {PIPELINE_ISSUE: "25"}});
        assert.deepEqual(env, {
            CLAUDE_CODE_OAUTH_TOKEN: "t",
            NOTION_TOKEN: "n",
            PIPELINE_EVIDENCE_ACCOUNT: "acc",
            PIPELINE_EVIDENCE_TOKEN: "tok",
            PIPELINE_EVIDENCE_URL: "https://e",
            PIPELINE_ISSUE: "25",
            GH_MINT_KEY: "k"
        });
    });
    test("startEnv with a profile leaves out the tokens the profile replaces", () => {
        const loopEnv = {CLAUDE_CODE_OAUTH_TOKEN: "t", ANTHROPIC_API_KEY: "a", NOTION_TOKEN: "n"};
        const env = startEnv(sandboxSettings(), loopEnv, {...BASE, profile: true});
        assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
        assert.equal(env.ANTHROPIC_API_KEY, undefined);
        assert.equal(env.NOTION_TOKEN, "n");
    });
    test("loginArgs runs the login script interactively under the persona's profile", () => {
        const args = loginArgs("img", {persona: "qa", harness: "codex"});
        assert.deepEqual(args.slice(0, 7), [
            "run",
            "-it",
            "--rm",
            "--network",
            "host",
            "--name",
            "factory-login-qa"
        ]);
        assert.ok(args.includes("sozi-factory-profile-qa:/profile"));
        assert.ok(args.includes("PIPELINE_LOGIN_HARNESS=codex"));
        assert.deepEqual(args.slice(-2), ["img", "/pipeline/login.sh"]);
    });
    const CALL = {key: "177", checkout: "/c", out: "/x", model: "m", now: 42};
    test("consultArgs runs a fresh call under the architect's profile, named by now", () => {
        const {args, env} = consultArgs(
            sandboxSettings(),
            {CLAUDE_CODE_OAUTH_TOKEN: "t"},
            {...CALL, session: null}
        );
        assert.equal(args[args.indexOf("--name") + 1], "factory-advisor-177-42");
        assert.ok(args.includes("sozi-factory-profile-architect:/profile"));
        assert.ok(args.includes("/c:/advisor") && args.includes("/x:/consult"));
        assert.ok(args.includes("--prompt") && !args.includes("resume"));
        assert.deepEqual(env, {}, "a profile's login replaces the tokens");
    });
    test("consultArgs resumes a session, and passes the tokens when profiles are off", () => {
        const settings = sandboxSettings();
        settings.profiles = "off";
        const {args, env} = consultArgs(
            settings,
            {CLAUDE_CODE_OAUTH_TOKEN: "t"},
            {...CALL, session: "s1"}
        );
        const call = args.indexOf("/pipeline/harness/claude");
        assert.deepEqual(args.slice(call + 1, call + 6), [
            "resume",
            "--session",
            "s1",
            "--message",
            "/consult/prompt.md"
        ]);
        assert.ok(!args.some(a => a.includes("/profile")));
        assert.deepEqual(env, {CLAUDE_CODE_OAUTH_TOKEN: "t"});
    });
});
