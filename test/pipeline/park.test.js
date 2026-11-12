// test/pipeline/park.test.js: parking an issue, its tries and the stub-harness park.
import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {countTry, parkStub} from "../../pipeline/lib/park.js";
import {end, issue, world} from "./pass-world.js";

/**
 * A pass context over the fakes of a world, with issue 25 at a stage.
 *
 * @param {string} stage - The stage label of issue 25.
 * @returns {{ctx: any, w: any}} The context and the world it was built on.
 */
function context(stage) {
    const w = world({issues: [issue(25, [stage])]});
    const ctx = {
        ...w,
        log: (/** @type {string} */ line) => w.logs.push(line),
        changed: new Set(),
        tried: new Set(),
        summary: {started: [], finished: [], moved: [], parked: [], spawns: 0, stopped: null}
    };
    return {ctx, w};
}

/**
 * The comments posted to GitHub, as [persona, issue, body].
 *
 * @param {any} w - The world.
 * @returns {any[][]} The comments.
 */
function comments(w) {
    return w.calls.filter((/** @type {any[]} */ c) => c[0] === "comment").map(c => c.slice(1));
}

/** @type {string[]} */
const outboxes = [];
after(() => {
    for (const dir of outboxes) {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

/**
 * An outbox whose log ends with the given lines.
 * The outbox is removed after the file's tests have run.
 *
 * @param {string} text - The log.
 * @returns {string} The outbox directory.
 */
function outboxWithLog(text) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "park-"));
    outboxes.push(dir);
    fs.writeFileSync(path.join(dir, "log"), text);
    return dir;
}

describe("countTry", () => {
    test("below the limit counts the try, logs it and leaves the stage alone", async () => {
        const {ctx, w} = context("stage:todo");
        await countTry(ctx, 25, outboxWithLog("x\n"));
        assert.equal(w.state.issues[25].tries, 1);
        assert.equal(w.state.issues[25].stage, "stage:todo");
        assert.ok(ctx.tried.has(25));
        assert.ok(w.logs.includes("#25: no move from stage:todo; try 1"));
        assert.deepEqual(comments(w), []);
        assert.deepEqual(ctx.summary.parked, []);
    });

    test("on the last try parks the issue and comments with the log tail", async () => {
        const {ctx, w} = context("stage:todo");
        const outbox = outboxWithLog("first\nlast line\n");
        for (let i = 0; i < 3; i++) {
            await countTry(ctx, 25, outbox);
        }
        assert.equal(w.state.issues[25].stage, "stage:parked");
        assert.equal(w.state.issues[25].parkedAt, new Date(w.clock.now()).toISOString());
        assert.deepEqual(ctx.summary.moved, [[25, "stage:todo", "stage:parked"]]);
        assert.deepEqual(ctx.summary.parked, [25]);
        assert.ok(ctx.changed.has(25));
        const [[persona, n, body]] = comments(w);
        assert.equal(persona, "ops");
        assert.equal(n, 25);
        assert.match(body, /stage ended 3 times without moving this issue, so I am parking it/);
        assert.match(body, /```\nfirst\nlast line\n```\n$/);
        assert.ok(
            w.calls.some(
                (/** @type {any[]} */ c) =>
                    c[0] === "label" &&
                    c[1].issue === 25 &&
                    c[1].add.includes("stage:parked") &&
                    c[1].remove.includes("stage:todo")
            )
        );
    });

    test("while GitHub is backed off the parking comment is queued, not posted", async () => {
        const {ctx, w} = context("stage:todo");
        w.state.sync.backoffUntil = new Date(w.clock.now() + 60_000).toISOString();
        for (let i = 0; i < 3; i++) {
            await countTry(ctx, 25, outboxWithLog("tail\n"));
        }
        assert.equal(w.state.issues[25].stage, "stage:parked");
        assert.deepEqual(comments(w), []);
        const queued = w.state.queued.filter((/** @type {any} */ q) => "comment" in q);
        assert.equal(queued.length, 1);
        assert.equal(queued[0].comment.issue, 25);
        assert.match(queued[0].comment.body, /parking it/);
    });
});

describe("parkStub", () => {
    test("with a planned harness names the plan's Harness line", async () => {
        const {ctx, w} = context("stage:review");
        w.state.issues[25].session = {stage: "review", planned: true, harness: "opencode"};
        await parkStub(ctx, 25);
        assert.equal(w.state.issues[25].stage, "stage:parked");
        const [[, , body]] = comments(w);
        assert.match(body, /`opencode` harness is a stub/);
        assert.match(body, /the plan's \*\*Harness\*\* line for `review`/);
        assert.doesNotMatch(body, /PIPELINE_HARNESS_REVIEW/);
    });

    test("without a planned harness names the stage setting", async () => {
        const {ctx, w} = context("stage:review");
        w.state.issues[25].session = {stage: "review", harness: "opencode"};
        await parkStub(ctx, 25);
        const [[, , body]] = comments(w);
        assert.match(body, /set `PIPELINE_HARNESS_REVIEW`/);
        assert.doesNotMatch(body, /\*\*Harness\*\* line/);
    });
});

describe("a stub harness the plan named", () => {
    test("the park names the plan's harness and points to its Harness line", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        w.github.planComment = async () =>
            "**Harness**\n\n- review: opencode some-model\n\n**Blocked by**\n\nnone.\n";
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {exit: 69, status: "unsupported"});
        await w.p.pass();
        assert.equal(w.state.issues[25].stage, "stage:parked");
        // The park comes first, then the session's usage comment.
        const [[, , park], [, , usage]] = comments(w);
        assert.match(park, /`opencode` harness is a stub/);
        assert.match(park, /the plan's \*\*Harness\*\* line for `review`/);
        assert.doesNotMatch(park, /PIPELINE_HARNESS_REVIEW/);
        assert.match(usage, /^<details>\n<summary>⏱ review · opencode some-model · /);
    });
});
