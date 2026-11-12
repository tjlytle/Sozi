// test/pipeline/sandbox-outbox.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {copyIdentities, createSandbox} from "../../pipeline/lib/sandbox.js";
import {recording, sandboxSettings} from "./sandbox-world.js";

describe("sandbox: outbox", () => {
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
    test("prepareOutbox copies the carry, and the resume message when resuming", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-"));
        const {sb: s} = recording(() => ({code: 0}), root);
        const old = fs.mkdtempSync(path.join(os.tmpdir(), "old-"));
        fs.writeFileSync(path.join(old, "carry.bundle"), "B");
        fs.writeFileSync(path.join(old, "carry.patch"), "P");
        fs.writeFileSync(path.join(old, "usage.json"), "{}");
        const base = {issue: 25, stage: "build", prompt: "p", allow: "a"};
        const fresh = s.prepareOutbox({...base, carryFrom: old});
        assert.equal(fs.readFileSync(path.join(fresh, "carry.bundle"), "utf8"), "B");
        assert.equal(fs.readFileSync(path.join(fresh, "carry.patch"), "utf8"), "P");
        assert.equal(fs.existsSync(path.join(fresh, "resume.md")), false);
        assert.equal(fs.existsSync(path.join(fresh, "usage.json")), false);
        const resumed = s.prepareOutbox({...base, carryFrom: old, resume: "carry on"});
        assert.equal(fs.readFileSync(path.join(resumed, "resume.md"), "utf8"), "carry on");
        assert.equal(fs.readFileSync(path.join(resumed, "prompt.md"), "utf8"), "p");
    });
    test("prepareOutbox copies the patches left by the last try into carried/", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "sb-"));
        const {sb: s} = recording(() => ({code: 0}), root);
        const old = fs.mkdtempSync(path.join(os.tmpdir(), "old-"));
        fs.writeFileSync(path.join(old, "75-x.patch"), "D");
        const base = {issue: 25, stage: "build", prompt: "p", allow: "a"};
        const dir = s.prepareOutbox({...base, patches: {from: old, names: ["75-x.patch"]}});
        assert.equal(fs.readFileSync(path.join(dir, "carried", "75-x.patch"), "utf8"), "D");
        const plain = s.prepareOutbox(base);
        assert.equal(fs.existsSync(path.join(plain, "carried")), false);
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
            settings: sandboxSettings(),
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
