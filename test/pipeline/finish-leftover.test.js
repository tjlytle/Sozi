// test/pipeline/finish-leftover.test.js: judging an ended session, the patches it leaves for
// the next try. Apart from finish.test.js, which judges requests, waits, usage and carry.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {end, issue, world} from "./pass-world.js";

describe("patches a session leaves for the next try", () => {
    test("a try that counts with a patch in its outbox records it", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        fs.writeFileSync(path.join(outbox, "75-x.patch"), "diff");
        end(w, outbox, "c25");
        await w.p.pass();
        assert.equal(w.state.issues[25].tries, 1);
        assert.deepEqual(w.state.issues[25].leftover, {
            stage: "build",
            outbox,
            patches: ["75-x.patch"]
        });
        assert.ok(w.logs.some(l => /#25: 1 patch\(es\) kept for the next try/.test(l)));
    });
    test("a session that moved the issue records none", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        fs.writeFileSync(path.join(outbox, "75-x.patch"), "diff");
        end(w, outbox, "c25", {requests: {done: {done: {issue: 25, to: "stage:review"}}}});
        await w.p.pass();
        assert.equal(w.state.issues[25].stage, "stage:review");
        assert.equal(w.state.issues[25].leftover ?? null, null);
    });
    test("a usage-limit stop records none", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        fs.writeFileSync(path.join(outbox, "75-x.patch"), "diff");
        end(w, outbox, "c25", {exit: 75, status: "rate-limited"});
        await w.p.pass();
        assert.equal(w.state.issues[25].leftover ?? null, null);
    });
    test("a try with no patch keeps the earlier leftover", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        const earlier = {stage: "build", outbox: "/old", patches: ["75-x.patch"]};
        w.state.issues[25].leftover = earlier;
        await w.p.pass();
        end(w, w.state.issues[25].session.outbox, "c25");
        await w.p.pass();
        assert.equal(w.state.issues[25].tries, 1);
        assert.deepEqual(w.state.issues[25].leftover, earlier);
    });
});
