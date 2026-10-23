// test/pipeline/sandbox.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {copyIdentities, createSandbox} from "../../pipeline/lib/sandbox.js";
import {loadConfig} from "../../pipeline/lib/config.js";

const REPO = path.resolve(import.meta.dirname, "..", "..");

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
        assert.ok(args.includes("PIPELINE_MODEL=claude-fable-5-1"));
        assert.ok(args.includes("PIPELINE_HARNESS=claude"));
        assert.ok(args.includes("--add-host=host.docker.internal:host-gateway"));
        assert.ok(args.includes("PIPELINE_ISSUE") && args.includes("NOTION_TOKEN"));
    });

    /**
     * A sandbox whose runner records commands and answers from a table.
     *
     * @param {(cmd: string[]) => {code: number, stdout?: string, stderr?: string}} answer - The reply per command.
     * @param {string} [root] - The repository root.
     * @returns {{sb: any, calls: {cmd: string[], opts: any}[]}} - The sandbox and its calls.
     */
    function recording(answer, root = "/repo") {
        /** @type {{cmd: string[], opts: any}[]} */
        const calls = [];
        const run = async (/** @type {string[]} */ cmd, /** @type {any} */ opts) => {
            calls.push({cmd, opts});
            const a = answer(cmd);
            return {code: a.code, stdout: a.stdout ?? "", stderr: a.stderr ?? ""};
        };
        return {sb: createSandbox({settings, root, run, pluginDir: "/plugins/gh-personas"}), calls};
    }

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
    test("buildImage builds from the repo root with the plugin as a named context", async () => {
        const {sb: s, calls} = recording(() => ({code: 0}));
        await s.buildImage();
        const cmd = calls[0].cmd;
        assert.deepEqual(cmd.slice(0, 3), ["docker", "build", "-t"]);
        assert.ok(cmd.includes("--build-context"));
        assert.equal(cmd[cmd.indexOf("--build-context") + 1], "ghp=/plugins/gh-personas");
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
    /** A sandbox whose runner records every command and answers through a function.
     *
     * @param {(cmd: string[]) => {code: number, stderr?: string}} answer - The result per command.
     * @returns {{sb3: ReturnType<typeof createSandbox>, cmds: string[][]}} - The sandbox and the log.
     */
    function copying(answer) {
        /** @type {string[][]} */
        const cmds = [];
        const sb3 = createSandbox({
            settings,
            root: "/repo",
            run: async cmd => {
                cmds.push(cmd);
                return {stdout: "", stderr: "", ...answer(cmd)};
            }
        });
        return {sb3, cmds};
    }
    const QA = "sozi-factory-profile-qa";
    test("copyProfile checks the source, creates the target, copies into /profile", async () => {
        const {sb3, cmds} = copying(cmd => ({
            code: cmd[2] === "inspect" && cmd[3] === QA ? 1 : 0
        }));
        await sb3.copyProfile({from: "builder", to: "qa"});
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
        const {sb3, cmds} = copying(cmd => ({code: cmd[2] === "inspect" ? 1 : 0}));
        await assert.rejects(
            sb3.copyProfile({from: "builder", to: "qa"}),
            /^Error: no profile for builder: run npm run pipeline -- --login builder$/
        );
        assert.equal(cmds.length, 1);
        assert.ok(!cmds.some(c => c[2] === "create" || c[1] === "run"));
    });
    test("copyProfile removes the target when the copy fails", async () => {
        const {sb3, cmds} = copying(cmd => {
            if (cmd[1] === "run") {
                return {code: 1, stderr: "cp: Permission denied"};
            }
            return {code: cmd[2] === "inspect" && cmd[3] === QA ? 1 : 0};
        });
        await assert.rejects(sb3.copyProfile({from: "builder", to: "qa"}), /Permission denied/);
        assert.deepEqual(cmds.at(-1), ["docker", "volume", "rm", QA]);
    });
    test("copyProfile refuses when the target already has a volume", async () => {
        const {sb3, cmds} = copying(() => ({code: 0}));
        await assert.rejects(
            sb3.copyProfile({from: "builder", to: "qa"}),
            /^Error: profile of qa exists; remove the volume first$/
        );
        assert.equal(cmds.length, 2);
        assert.ok(!cmds.some(c => c[2] === "create" || c[1] === "run"));
        await assert.rejects(sb3.copyProfile({from: "root", to: "qa"}), /unknown persona/);
    });
    test("after the image name comes a /pipeline/ script or -c, as the entrypoint is bash", async () => {
        const text = fs.readFileSync(path.join(REPO, "docker", "factory", "Dockerfile"), "utf8");
        const entrypoints = [...text.matchAll(/^ENTRYPOINT\s+(.*)$/gm)];
        assert.equal(entrypoints.at(-1)?.[1].trim(), '["bash"]');
        /** @type {string[]} */
        let inspect = [];
        const {sb3, cmds} = copying(cmd => {
            if (cmd[1] === "run" && cmd.includes("/pipeline/profile-inspect.sh")) {
                inspect = cmd;
            }
            return {code: cmd[2] === "inspect" && cmd[3] === QA ? 1 : 0};
        });
        await sb3.inspectProfile("builder").catch(() => null);
        await sb3.copyProfile({from: "builder", to: "qa"});
        const copy = cmds.find(c => c[1] === "run" && c.includes(`${QA}:/profile`)) ?? [];
        const login = sb3.loginArgs({persona: "qa", harness: "claude"});
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
    test("copyIdentities keeps only the commit name and email, and skips a missing persona (#80)", () => {
        const from = fs.mkdtempSync(path.join(os.tmpdir(), "ghbot-"));
        const to = fs.mkdtempSync(path.join(os.tmpdir(), "ghbot-out-"));
        fs.mkdirSync(path.join(from, "qa"));
        fs.writeFileSync(
            path.join(from, "qa", "bot-env"),
            'BOT_GIT_NAME="ll-qa[bot]"\nAPP_ID=123\n  BOT_GIT_EMAIL="1+ll-qa[bot]@users.noreply.github.com"\nPRIVATE_KEY=/keys/qa.pem\n'
        );
        copyIdentities(from, to);
        assert.equal(
            fs.readFileSync(path.join(to, "qa", "bot-env"), "utf8"),
            'BOT_GIT_NAME="ll-qa[bot]"\nBOT_GIT_EMAIL="1+ll-qa[bot]@users.noreply.github.com"\n'
        );
        assert.ok(!fs.existsSync(path.join(to, "builder")), "no host file, nothing written");
    });
    test("each outbox gets the identities and stages are pointed at them (#80)", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-root-"));
        const from = fs.mkdtempSync(path.join(os.tmpdir(), "ghbot-"));
        fs.mkdirSync(path.join(from, "builder"));
        fs.writeFileSync(path.join(from, "builder", "bot-env"), 'BOT_GIT_NAME="ll-builder[bot]"\n');
        const local = createSandbox({
            settings,
            root,
            run: async () => ({code: 0, stdout: "", stderr: ""}),
            botConfigDir: from
        });
        const dir = local.prepareOutbox({issue: 25, stage: "build", prompt: "p", allow: "a"});
        assert.equal(
            fs.readFileSync(path.join(dir, "gh-bot", "builder", "bot-env"), "utf8"),
            'BOT_GIT_NAME="ll-builder[bot]"\n'
        );
        const args = local.startArgs({
            issue: 25,
            stage: "build",
            outbox: dir,
            mintUrl: "u",
            mintKey: "k"
        });
        assert.ok(args.includes("GH_BOT_CONFIG_DIR=/outbox/gh-bot"));
    });
});
