import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();

/** Make a scratch directory under .agents/tmp.
 *
 * @returns {string} - The directory.
 */
function scratch() {
    return fs.mkdtempSync(path.join(root, ".agents", "tmp", "profile-copy-"));
}

/** Run a pipeline script with the given environment.
 *
 * @param {string} name - The script under pipeline/.
 * @param {Record<string, string>} env - Variables added to the environment.
 * @returns {{status: number | null, out: string}} - The exit status and stdout plus stderr.
 */
function runScript(name, env) {
    const r = spawnSync("bash", [path.join(root, "pipeline", name)], {
        encoding: "utf8",
        env: {...process.env, ...env}
    });
    return {status: r.status, out: r.stdout + r.stderr};
}

/** Copy a source profile, built by `fill`, into an empty target.
 *
 * @param {(from: string) => void} fill - Writes the source profile.
 * @param {(to: string, out: string) => void} check - Asserts on the target and the output.
 */
function copying(fill, check) {
    const dir = scratch();
    const from = path.join(dir, "from");
    const to = path.join(dir, "to");
    try {
        fs.mkdirSync(path.join(from, "claude"), {recursive: true});
        fs.mkdirSync(to);
        fill(from);
        const {status, out} = runScript("profile-copy.sh", {FROM: from, PROFILE: to});
        assert.equal(status, 0, out);
        check(to, out);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

/** Write a credentials file with mode 0600.
 *
 * @param {string} profile - The profile directory.
 * @param {string} text - The file content.
 */
function writeCreds(profile, text) {
    fs.writeFileSync(path.join(profile, "claude", ".credentials.json"), text, {mode: 0o600});
}

const CREDS = JSON.stringify({
    claudeAiOauth: {accessToken: "SECRET-ACCESS", refreshToken: "SECRET-REFRESH"},
    mcpOAuth: {mobbin: {accessToken: "SECRET-MCP"}}
});

test("the Claude login is stripped, the MCP authorisations kept, the mode stays 0600", () => {
    copying(
        from => writeCreds(from, CREDS),
        to => {
            const file = path.join(to, "claude", ".credentials.json");
            assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
                mcpOAuth: {mobbin: {accessToken: "SECRET-MCP"}}
            });
            assert.equal(fs.statSync(file).mode & 0o777, 0o600);
            const inspect = runScript("profile-inspect.sh", {PROFILE: to});
            assert.equal(JSON.parse(inspect.out).claude.loggedIn, false);
        }
    );
});

test("a credentials file holding only the login is removed", () => {
    copying(
        from => writeCreds(from, '{"claudeAiOauth":{"accessToken":"SECRET"}}'),
        to => assert.ok(!fs.existsSync(path.join(to, "claude", ".credentials.json")))
    );
});

test("the settings, the skills and the codex directory copy unchanged", () => {
    const settings = '{"mcpServers":{"mobbin":{}}}';
    const skill = "# a skill\n";
    const auth = '{"token":"codex"}';
    copying(
        from => {
            writeCreds(from, CREDS);
            fs.writeFileSync(path.join(from, "claude", ".claude.json"), settings);
            fs.mkdirSync(path.join(from, "claude", "skills", "one"), {recursive: true});
            fs.writeFileSync(path.join(from, "claude", "skills", "one", "SKILL.md"), skill);
            fs.mkdirSync(path.join(from, "codex"));
            fs.writeFileSync(path.join(from, "codex", "auth.json"), auth);
        },
        to => {
            const read = (/** @type {string[]} */ ...p) =>
                fs.readFileSync(path.join(to, ...p), "utf8");
            assert.equal(read("claude", ".claude.json"), settings);
            assert.equal(read("claude", "skills", "one", "SKILL.md"), skill);
            assert.equal(read("codex", "auth.json"), auth);
        }
    );
});

test("a credentials file that does not parse is left as it is", () => {
    copying(
        from => writeCreds(from, "{not json SECRET"),
        to => {
            const file = path.join(to, "claude", ".credentials.json");
            assert.equal(fs.readFileSync(file, "utf8"), "{not json SECRET");
        }
    );
});

test("the output holds no token value", () => {
    copying(
        from => writeCreds(from, CREDS),
        (to, out) => assert.ok(!out.includes("SECRET"), out)
    );
});
