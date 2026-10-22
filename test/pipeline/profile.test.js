import {test} from "node:test";
import assert from "node:assert/strict";
import {personaFor, profileArgs, volumeName} from "../../pipeline/lib/profile.js";

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
