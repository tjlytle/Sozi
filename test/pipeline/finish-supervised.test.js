// test/pipeline/finish-supervised.test.js: judging an ended session, the supervision side:
// the supervised label a plan earns and the protected patch a build leaves. Apart from
// finish.test.js, which judges requests, waits, usage and carry.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {end, issue, world} from "./pass-world.js";

/**
 * Run a plan session of issue 25 to a done, with the given plan comment.
 *
 * @param {string} planText - What planComment returns.
 * @returns {Promise<any>} - The world after the judging pass.
 */
async function planDone(planText) {
    const w = world({issues: [issue(25, ["stage:todo"])]});
    w.github.planComment = async () => planText;
    await w.p.pass();
    end(w, w.state.issues[25].session.outbox, "c25", {
        requests: {done: {done: {issue: 25, to: "stage:tests"}}}
    });
    await w.p.pass();
    return w;
}

/**
 * Run a build session of issue 25 that leaves a protected.patch and a wait request.
 *
 * @param {string} patch - The patch.
 * @returns {Promise<any>} - The world after the judging pass.
 */
async function protectedBuild(patch) {
    const w = world({issues: [issue(25, ["stage:in-progress"])]});
    await w.p.pass();
    const outbox = w.state.issues[25].session.outbox;
    fs.writeFileSync(path.join(outbox, "protected.patch"), patch);
    end(w, outbox, "c25", {requests: {wait: {wait: "needs a .claude/ change"}}});
    await w.p.pass();
    return w;
}

/**
 * The label writes that added supervised.
 *
 * @param {any} w - The world.
 * @returns {any[][]} - The calls.
 */
function supervisedAdds(w) {
    return w.calls.filter(
        (/** @type {any[]} */ c) => c[0] === "label" && c[1].add.includes("supervised")
    );
}

describe("the supervised label from a plan", () => {
    test("a plan done whose Shape touches pipeline/ adds supervised", async () => {
        const w = await planDone("### Shape\n\n- `pipeline/lib/due.js`: x\n\n### Tests\n");
        assert.ok(w.state.issues[25].labels.includes("supervised"));
        assert.equal(supervisedAdds(w).length, 1);
    });
    test("a plan done whose Shape stays outside pipeline/ adds nothing", async () => {
        const w = await planDone("### Shape\n\n- `src/js/player.js`\n");
        assert.ok(!w.state.issues[25].labels.includes("supervised"));
        assert.equal(supervisedAdds(w).length, 0);
    });
    test("a plan that cannot be read labels supervised, so the loop does not run it", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        w.github.planComment = async () => {
            throw new Error("502 Bad Gateway");
        };
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25", {
            requests: {done: {done: {issue: 25, to: "stage:tests"}}}
        });
        await w.p.pass();
        assert.ok(w.state.issues[25].labels.includes("supervised"));
        assert.equal(supervisedAdds(w).length, 1);
    });
});

describe("a protected patch", () => {
    test("is kept, and the issue labelled supervised and waiting, with no try", async () => {
        const patch = "diff --git a/.claude/x b/.claude/x\n--- a/.claude/x\n+++ b/.claude/x\n";
        const w = await protectedBuild(patch);
        const kept = path.join(w.protectedDir, "25.patch");
        assert.equal(fs.readFileSync(kept, "utf8"), patch);
        assert.ok(w.state.issues[25].labels.includes("supervised"));
        assert.equal(supervisedAdds(w).length, 1);
        assert.equal(w.state.issues[25].waiting, true);
        assert.equal(w.state.issues[25].tries, 0);
    });
    test("naming a path outside .claude/ is refused with a comment", async () => {
        const w = await protectedBuild("diff --git a/src/a.js b/src/a.js\n");
        assert.ok(!fs.existsSync(path.join(w.protectedDir, "25.patch")));
        assert.ok(!w.state.issues[25].labels.includes("supervised"));
        const refused = w.calls.filter(
            (/** @type {any[]} */ c) =>
                c[0] === "comment" && c[2] === 25 && /src\/a\.js/.test(String(c[3]))
        );
        assert.equal(refused.length, 1);
    });
});
