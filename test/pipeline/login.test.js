import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();

/** Run the login script on a profile directory without a shell at the end.
 *
 * @param {string} dir - The profile directory.
 * @param {Record<string, string>} env - The login persona and harness.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} - The result.
 */
function login(dir, env) {
    return spawnSync("bash", [path.join(root, "pipeline", "login.sh")], {
        encoding: "utf8",
        env: {
            ...process.env,
            PROFILE: dir,
            SHELL_CMD: "true",
            AGY_HOME_LINK: path.join(dir, ".gemini-link"),
            ...env
        }
    });
}

/** Make a scratch profile directory.
 *
 * @returns {string} - The directory.
 */
function scratch() {
    return fs.mkdtempSync(path.join(root, ".agents", "tmp", "login-"));
}

test("the login shell refuses an unwritable profile", {skip: process.getuid?.() === 0}, () => {
    const dir = scratch();
    try {
        fs.chmodSync(dir, 0o500);
        const r = login(dir, {PIPELINE_LOGIN_PERSONA: "qa", PIPELINE_LOGIN_HARNESS: "claude"});
        assert.equal(r.status, 1);
        assert.match(r.stdout, /not writable/);
    } finally {
        fs.chmodSync(dir, 0o700);
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

test("the banner names the persona, the volume and the claude steps", () => {
    const dir = scratch();
    try {
        const r = login(dir, {PIPELINE_LOGIN_PERSONA: "qa", PIPELINE_LOGIN_HARNESS: "claude"});
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /sozi-factory-profile-qa/);
        assert.match(r.stdout, /claude/);
        assert.match(r.stdout, /\/login/);
        assert.match(r.stdout, /open the URL on the host, paste the code/);
        assert.match(r.stdout, /claude mcp add --scope user <name>/);
        assert.match(r.stdout, /\/mcp` to authorise it/);
        assert.match(r.stdout, /exit/);
        for (const sub of ["claude", "codex", "gemini", "xdg"]) {
            assert.ok(fs.statSync(path.join(dir, sub)).isDirectory(), sub);
        }
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

test("the banner names the codex and opencode commands", () => {
    const dir = scratch();
    try {
        const codex = login(dir, {PIPELINE_LOGIN_PERSONA: "qa", PIPELINE_LOGIN_HARNESS: "codex"});
        assert.match(codex.stdout, /codex login --device-auth/);
        const other = login(dir, {
            PIPELINE_LOGIN_PERSONA: "qa",
            PIPELINE_LOGIN_HARNESS: "opencode"
        });
        assert.match(other.stdout, /opencode auth login/);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

test("the agy banner names agy and links ~/.gemini to the profile", () => {
    const dir = scratch();
    const link = path.join(dir, "home-gemini");
    try {
        const r = login(dir, {
            PIPELINE_LOGIN_PERSONA: "qa",
            PIPELINE_LOGIN_HARNESS: "agy",
            AGY_HOME_LINK: link
        });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /Run `agy`/);
        assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(dir, "gemini")));
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});
