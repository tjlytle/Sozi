// test/pipeline/consults.test.js: a pass hands questions to the advisor, refuses past the limit and nudges once.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {issue, world} from "./pass-world.js";

const MINUTE = 60 * 1000;

/**
 * Write a question file into a session's outbox.
 *
 * @param {string} outbox - The outbox.
 * @param {number} n - The question number.
 * @param {any} body - The question, written as JSON unless it is a string.
 * @returns {void}
 */
function question(outbox, n, body) {
    fs.mkdirSync(path.join(outbox, "advise"), {recursive: true});
    const text = typeof body === "string" ? body : JSON.stringify(body);
    fs.writeFileSync(path.join(outbox, "advise", `q-${n}.json`), text);
}

/**
 * An answer file of a session's outbox.
 *
 * @param {string} outbox - The outbox.
 * @param {number} n - The question number.
 * @returns {any} The answer, or null when there is none.
 */
function answer(outbox, n) {
    const file = path.join(outbox, "advise", `a-${n}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

/**
 * A world with issue 25 of epic 123 in build, its session started.
 *
 * @returns {Promise<{w: any, outbox: string}>} The world and the session's outbox.
 */
async function building() {
    const w = world({issues: [issue(25, ["stage:in-progress"], {body: "Part of #123"})]});
    await w.p.pass();
    return {w, outbox: w.state.issues[25].session.outbox};
}

describe("consults", () => {
    test("a question is handed to the advisor once, and the pass counts it", async () => {
        const {w, outbox} = await building();
        question(outbox, 1, {question: "Why?", stage: "build", issue: 25, diff: "d"});
        const s = await w.p.pass();
        assert.equal(s.consults, 1);
        assert.equal(w.asks.length, 1);
        const [a] = w.asks;
        assert.equal(a.outbox, outbox);
        assert.equal(a.n, 1);
        assert.equal(a.issue, 25);
        assert.equal(a.epic, 123);
        assert.equal(a.stage, "build");
        assert.equal(a.session, w.state.issues[25].session);
        assert.deepEqual(a.question, {question: "Why?", stage: "build", diff: "d", failing: ""});
        const again = await w.p.pass();
        assert.equal(again.consults, 0);
        assert.equal(w.asks.length, 1);
    });

    test("the third question in one session is refused with the limit", async () => {
        const {w, outbox} = await building();
        for (const n of [1, 2, 3]) {
            question(outbox, n, {question: `q${n}`});
        }
        const s = await w.p.pass();
        assert.equal(s.consults, 3);
        assert.deepEqual(
            w.asks.map(a => a.n),
            [1, 2]
        );
        assert.deepEqual(answer(outbox, 3), {
            refused: "advisor limit reached: 2 consults a session (PIPELINE_ADVISOR_MAX)"
        });
    });

    test("a question that is not valid is answered with why", async () => {
        const {w, outbox} = await building();
        question(outbox, 1, "{");
        question(outbox, 2, {question: "q", issue: 99});
        await w.p.pass();
        assert.equal(w.asks.length, 0);
        assert.match(answer(outbox, 1).error, /not JSON/);
        assert.match(answer(outbox, 2).error, /#99, not #25/);
    });

    test("an advise directory that is a link is not answered into", async () => {
        const {w, outbox} = await building();
        const elsewhere = fs.mkdtempSync(path.join(path.dirname(outbox), "elsewhere-"));
        fs.writeFileSync(path.join(elsewhere, "q-1.json"), JSON.stringify({question: "q"}));
        fs.symlinkSync(elsewhere, path.join(outbox, "advise"));
        await w.p.pass();
        assert.equal(w.asks.length, 0);
        assert.deepEqual(fs.readdirSync(elsewhere), ["q-1.json"]);
    });

    test("a session past half its time is nudged once", async () => {
        const {w, outbox} = await building();
        w.clock.advance(20 * MINUTE);
        await w.p.pass();
        assert.ok(!fs.existsSync(path.join(outbox, "nudge.md")), "not before the share");
        w.clock.advance(3 * MINUTE);
        await w.p.pass();
        const text = fs.readFileSync(path.join(outbox, "nudge.md"), "utf8");
        assert.match(text, /you have spent 23 minutes on this; ask the advisor before going on/);
        fs.renameSync(path.join(outbox, "nudge.md"), path.join(outbox, "nudge.seen"));
        w.clock.advance(5 * MINUTE);
        await w.p.pass();
        assert.ok(!fs.existsSync(path.join(outbox, "nudge.md")), "only once");
    });
});
