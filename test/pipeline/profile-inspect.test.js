import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();

/** Run the inspect script on a profile directory.
 *
 * @param {string} dir - The profile directory.
 * @returns {{out: string, info: any}} - The raw output and the parsed line.
 */
function inspect(dir) {
    const r = spawnSync("bash", [path.join(root, "pipeline", "profile-inspect.sh")], {
        encoding: "utf8",
        env: {...process.env, PROFILE: dir}
    });
    assert.equal(r.status, 0, r.stderr);
    return {out: r.stdout, info: JSON.parse(r.stdout)};
}

test("an empty profile", () => {
    const dir = fs.mkdtempSync(path.join(root, ".agents", "tmp", "profile-"));
    try {
        const {info} = inspect(dir);
        assert.equal(info.claude.present, false);
        assert.equal(info.claude.loggedIn, false);
        assert.deepEqual(info.claude.servers, []);
        assert.equal(info.codex.present, false);
        assert.equal(info.writable, true);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

test("a logged-in claude profile with two servers", () => {
    const dir = fs.mkdtempSync(path.join(root, ".agents", "tmp", "profile-"));
    try {
        fs.mkdirSync(path.join(dir, "claude"));
        fs.mkdirSync(path.join(dir, "codex"));
        fs.writeFileSync(
            path.join(dir, "claude", ".credentials.json"),
            '{"claudeAiOauth":{"accessToken":"SECRET"}}'
        );
        fs.writeFileSync(
            path.join(dir, "claude", ".claude.json"),
            '{"mcpServers":{"mobbin":{},"context7":{}}}'
        );
        fs.writeFileSync(path.join(dir, "codex", "auth.json"), '{"token":"SECRET"}');
        const {out, info} = inspect(dir);
        assert.equal(info.claude.present, true);
        assert.equal(info.claude.loggedIn, true);
        assert.deepEqual(info.claude.servers, ["context7", "mobbin"]);
        assert.equal(info.codex.loggedIn, true);
        assert.ok(!out.includes("SECRET"));
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

/** Inspect a profile whose claude/.claude.json holds the given text.
 *
 * @param {string} text - The file content.
 * @returns {{out: string, info: any}} - The raw output and the parsed line.
 */
function inspectSettings(text) {
    const dir = fs.mkdtempSync(path.join(root, ".agents", "tmp", "profile-"));
    try {
        fs.mkdirSync(path.join(dir, "claude"));
        fs.writeFileSync(path.join(dir, "claude", ".claude.json"), text);
        return inspect(dir);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

test("local-scope servers under projects are merged with the user-scope ones", () => {
    const {info} = inspectSettings(
        JSON.stringify({
            mcpServers: {mobbin: {}},
            projects: {
                "/work": {mcpServers: {context7: {}, mobbin: {}}},
                "/home/factory": {mcpServers: {notion: {}}},
                "/empty": {}
            }
        })
    );
    assert.deepEqual(info.claude.servers, ["context7", "mobbin", "notion"]);
});

test("an array mcpServers and a malformed file give no servers", () => {
    assert.deepEqual(inspectSettings('{"mcpServers":["mobbin"]}').info.claude.servers, []);
    assert.deepEqual(inspectSettings("{not json").info.claude.servers, []);
});

test("updated is the credentials' modification time, null without them", () => {
    const dir = fs.mkdtempSync(path.join(root, ".agents", "tmp", "profile-"));
    try {
        fs.mkdirSync(path.join(dir, "claude"));
        assert.equal(inspect(dir).info.claude.updated, null);
        const creds = path.join(dir, "claude", ".credentials.json");
        fs.writeFileSync(creds, '{"claudeAiOauth":{"accessToken":"SECRET"}}');
        const when = new Date("2026-10-23T09:30:00.000Z");
        fs.utimesSync(creds, when, when);
        assert.equal(inspect(dir).info.claude.updated, when.toISOString());
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});
