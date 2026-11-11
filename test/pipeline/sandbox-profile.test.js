// test/pipeline/sandbox-profile.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createSandbox} from "../../pipeline/lib/sandbox.js";
import {REPO, recording, sandboxSettings} from "./sandbox-world.js";

describe("sandbox: profile", () => {
    const settings = sandboxSettings();
    const QA = "sozi-factory-profile-qa";
    test("login runs an interactive container on the host network with the volume", async () => {
        /** @type {string[]} */
        let cmd = [];
        const sb2 = createSandbox({
            settings,
            root: "/repo",
            run: async () => ({code: 0, stdout: "", stderr: ""}),
            runInteractive: c => {
                cmd = c;
                return 0;
            }
        });
        assert.equal(await sb2.login({persona: "architect", harness: "claude"}), 0);
        assert.deepEqual(cmd.slice(0, 4), ["docker", "run", "-it", "--rm"]);
        assert.ok(cmd.includes("--network") && cmd.includes("host"));
        assert.ok(cmd.includes("sozi-factory-profile-architect:/profile"));
        assert.ok(cmd.includes("PIPELINE_LOGIN_HARNESS=claude"));
        assert.ok(cmd.includes("PIPELINE_LOGIN_PERSONA=architect"));
        assert.deepEqual(cmd.slice(-2), [settings.image, "/pipeline/login.sh"]);
    });
    test("copyProfile checks the source, creates the target, copies into /profile", async () => {
        const {sb, calls} = recording(cmd => ({
            code: cmd[2] === "inspect" && cmd[3] === QA ? 1 : 0
        }));
        await sb.copyProfile({from: "builder", to: "qa"});
        const cmds = calls.map(c => c.cmd);
        assert.deepEqual(cmds[0], ["docker", "volume", "inspect", "sozi-factory-profile-builder"]);
        assert.deepEqual(cmds[1], ["docker", "volume", "inspect", QA]);
        assert.deepEqual(cmds[2], ["docker", "volume", "create", QA]);
        assert.deepEqual(cmds[3], [
            "docker",
            "run",
            "--rm",
            "-v",
            "sozi-factory-profile-builder:/from:ro",
            "-v",
            `${QA}:/profile`,
            settings.image,
            "/pipeline/profile-copy.sh"
        ]);
        assert.equal(cmds.length, 4);
    });
    test("copyProfile refuses a source with no volume and creates nothing", async () => {
        const {sb, calls} = recording(cmd => ({code: cmd[2] === "inspect" ? 1 : 0}));
        await assert.rejects(
            sb.copyProfile({from: "builder", to: "qa"}),
            /^Error: no profile for builder: run npm run pipeline -- --login builder$/
        );
        const cmds = calls.map(c => c.cmd);
        assert.equal(cmds.length, 1);
        assert.ok(!cmds.some(c => c[2] === "create" || c[1] === "run"));
    });
    test("copyProfile removes the target when the copy fails", async () => {
        const {sb, calls} = recording(cmd => {
            if (cmd[1] === "run") {
                return {code: 1, stderr: "cp: Permission denied"};
            }
            return {code: cmd[2] === "inspect" && cmd[3] === QA ? 1 : 0};
        });
        await assert.rejects(sb.copyProfile({from: "builder", to: "qa"}), /Permission denied/);
        assert.deepEqual(calls.at(-1)?.cmd, ["docker", "volume", "rm", QA]);
    });
    test("copyProfile refuses when the target already has a volume", async () => {
        const {sb, calls} = recording(() => ({code: 0}));
        await assert.rejects(
            sb.copyProfile({from: "builder", to: "qa"}),
            /^Error: profile of qa exists; remove the volume first$/
        );
        const cmds = calls.map(c => c.cmd);
        assert.equal(cmds.length, 2);
        assert.ok(!cmds.some(c => c[2] === "create" || c[1] === "run"));
        await assert.rejects(sb.copyProfile({from: "root", to: "qa"}), /unknown persona/);
    });
    test("after the image name comes a /pipeline/ script or -c, as the entrypoint is bash", async () => {
        const text = fs.readFileSync(path.join(REPO, "docker", "factory", "Dockerfile"), "utf8");
        const entrypoints = [...text.matchAll(/^ENTRYPOINT\s+(.*)$/gm)];
        assert.equal(entrypoints.at(-1)?.[1].trim(), '["bash"]');
        /** @type {string[]} */
        let inspect = [];
        const {sb, calls} = recording(cmd => {
            if (cmd[1] === "run" && cmd.includes("/pipeline/profile-inspect.sh")) {
                inspect = cmd;
            }
            return {code: cmd[2] === "inspect" && cmd[3] === QA ? 1 : 0};
        });
        await sb.inspectProfile("builder").catch(() => null);
        await sb.copyProfile({from: "builder", to: "qa"});
        const copy =
            calls.map(c => c.cmd).find(c => c[1] === "run" && c.includes(`${QA}:/profile`)) ?? [];
        const login = sb.loginArgs({persona: "qa", harness: "claude"});
        for (const [what, args] of Object.entries({login, inspect, copy})) {
            const next = args[args.indexOf(settings.image) + 1];
            assert.ok(args.includes(settings.image), what);
            assert.ok(next === "-c" || next.startsWith("/pipeline/"), `${what}: ${next}`);
        }
    });
    test("the image creates /profile for the factory user", () => {
        const text = fs.readFileSync(path.join(REPO, "docker", "factory", "Dockerfile"), "utf8");
        assert.match(text, /mkdir -p [^\n]*\/profile/);
        assert.match(text, /chown factory:factory [^\n]*\/profile/);
    });
});
