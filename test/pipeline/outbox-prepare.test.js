// test/pipeline/outbox-prepare.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {copyIdentities, prepareOutbox} from "../../pipeline/lib/outbox-prepare.js";

describe("outbox preparation", () => {
    test("a second outbox in the same minute gets the -2 suffix", () => {
        const varDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "op-")), "var");
        const bot = fs.mkdtempSync(path.join(os.tmpdir(), "ghbot-"));
        const now = new Date(Date.UTC(2026, 10, 12, 9, 5));
        const opts = {issue: 177, stage: "build", prompt: "p", allow: "a", now};
        const first = prepareOutbox(varDir, bot, opts);
        const second = prepareOutbox(varDir, bot, opts);
        assert.equal(path.basename(first), "out-177-build-20261112-0905");
        assert.equal(path.basename(second), "out-177-build-20261112-0905-2");
        assert.equal(fs.readFileSync(path.join(second, "prompt.md"), "utf8"), "p");
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
});
