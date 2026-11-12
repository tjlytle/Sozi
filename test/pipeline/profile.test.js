import {test} from "node:test";
import assert from "node:assert/strict";
import {
    checkAllowlist,
    copyProfile,
    inspectProfile,
    personaFor,
    profileArgs,
    volumeName
} from "../../pipeline/lib/profile.js";

test("stages map to personas; spawn takes its own", () => {
    assert.equal(personaFor("plan"), "architect");
    assert.equal(personaFor("tests"), "qa");
    assert.equal(personaFor("build"), "builder");
    assert.equal(personaFor("review"), "reviewer");
    assert.equal(personaFor("qa"), "qa");
    assert.equal(personaFor("spawn", "advocate"), "advocate");
    assert.throws(() => personaFor("deploy"), /no persona for stage deploy/);
});

test("volume name and mount arguments", () => {
    assert.equal(volumeName("builder"), "sozi-factory-profile-builder");
    assert.throws(() => volumeName("root"), /persona/);
    assert.deepEqual(profileArgs("qa"), [
        "-v",
        "sozi-factory-profile-qa:/profile",
        "-e",
        "CLAUDE_CONFIG_DIR=/profile/claude",
        "-e",
        "CODEX_HOME=/profile/codex",
        "-e",
        "XDG_CONFIG_HOME=/profile/xdg"
    ]);
});

test("inspectProfile: no volume is null; a volume is inspected read-only", async () => {
    /** @type {string[][]} */
    const calls = [];
    /** @type {import("../../pipeline/lib/github.js").Runner} */
    const run = async cmd => {
        calls.push(cmd);
        return cmd[1] === "volume"
            ? {code: 1, stdout: "", stderr: "no such volume"}
            : {code: 0, stdout: "", stderr: ""};
    };
    assert.equal(await inspectProfile(run, {image: "img", persona: "qa"}), null);
    assert.equal(calls.length, 1);
    /** @type {import("../../pipeline/lib/github.js").Runner} */
    const run2 = async cmd => ({
        code: 0,
        stdout:
            cmd[1] === "volume"
                ? "[]"
                : '{"claude":{"present":true,"loggedIn":true,"servers":["context7"]},"codex":{"present":false,"loggedIn":false},"writable":true}\n',
        stderr: ""
    });
    const info = await inspectProfile(run2, {image: "img", persona: "qa"});
    assert.deepEqual(info?.claude.servers, ["context7"]);
});

test("inspect uses a read-only mount and the image", async () => {
    /** @type {string[]} */
    let args = [];
    /** @type {import("../../pipeline/lib/github.js").Runner} */
    const run = async cmd => {
        if (cmd[1] === "run") {
            args = cmd;
        }
        return {
            code: 0,
            stdout:
                cmd[1] === "run"
                    ? '{"claude":{"present":false,"loggedIn":false,"servers":[]},"codex":{"present":false,"loggedIn":false},"writable":true}'
                    : "[]",
            stderr: ""
        };
    };
    await inspectProfile(run, {image: "sozi-factory", persona: "builder"});
    assert.ok(args.includes("sozi-factory-profile-builder:/profile:ro"));
    assert.ok(args.includes("--rm") && args.includes("sozi-factory"));
});

test("a profile that cannot be parsed fails by persona", async () => {
    /** @type {import("../../pipeline/lib/github.js").Runner} */
    const run = async () => ({code: 0, stdout: "garbage", stderr: ""});
    await assert.rejects(
        inspectProfile(run, {image: "img", persona: "qa"}),
        /profile inspect failed for qa/
    );
});

test("checkAllowlist names the servers the persona may not hold", () => {
    const info = {
        claude: {present: true, loggedIn: true, servers: ["mobbin", "context7"]},
        codex: {present: false, loggedIn: false},
        writable: true
    };
    assert.deepEqual(checkAllowlist(info, ["context7"]), ["mobbin"]);
    assert.deepEqual(checkAllowlist(info, ["context7", "mobbin"]), []);
});

test("checkAllowlist also names the Codex and agy servers, with their harness", () => {
    const info = {
        claude: {present: true, loggedIn: true, servers: []},
        codex: {present: true, loggedIn: true, servers: ["mobbin", "github"]},
        agy: {present: true, loggedIn: true, servers: ["github"]},
        writable: true
    };
    assert.deepEqual(checkAllowlist(info, ["mobbin"]), ["github (agy)", "github (codex)"]);
    assert.deepEqual(checkAllowlist(info, ["mobbin", "github"]), []);
});

/** A runner that records each command and answers from a table.
 *
 * @param {(cmd: string[]) => {code: number, stderr?: string}} answer - The reply per command.
 * @returns {{run: import("../../pipeline/lib/github.js").Runner, calls: string[][]}} - The runner and its calls.
 */
function recordingRun(answer) {
    /** @type {string[][]} */
    const calls = [];
    /** @type {import("../../pipeline/lib/github.js").Runner} */
    const run = async cmd => {
        calls.push(cmd);
        const a = answer(cmd);
        return {code: a.code, stdout: "", stderr: a.stderr ?? ""};
    };
    return {run, calls};
}

const COPY = {image: "img", from: "builder", to: "qa"};

test("copyProfile refuses a source with no volume", async () => {
    const {run, calls} = recordingRun(() => ({code: 1}));
    await assert.rejects(copyProfile(run, COPY), /no profile for builder/);
    assert.equal(calls.length, 1);
});

test("copyProfile refuses a target that exists", async () => {
    const {run, calls} = recordingRun(() => ({code: 0}));
    await assert.rejects(copyProfile(run, COPY), /profile of qa exists/);
    assert.ok(!calls.some(cmd => cmd[2] === "create"));
});

test("copyProfile copies into /profile in the image, and removes the target when that fails", async () => {
    const {run, calls} = recordingRun(cmd => {
        if (cmd[2] === "inspect") {
            return {code: cmd[3] === "sozi-factory-profile-builder" ? 0 : 1};
        }
        return cmd[1] === "run" ? {code: 1, stderr: "Permission denied"} : {code: 0};
    });
    await assert.rejects(copyProfile(run, COPY), /Permission denied/);
    const copy = calls.find(cmd => cmd[1] === "run") ?? [];
    assert.ok(copy.includes("sozi-factory-profile-builder:/from:ro"));
    assert.ok(copy.includes("sozi-factory-profile-qa:/profile"));
    assert.deepEqual(copy.slice(-2), ["img", "/pipeline/profile-copy.sh"]);
    assert.deepEqual(calls.at(-1), ["docker", "volume", "rm", "sozi-factory-profile-qa"]);
});
