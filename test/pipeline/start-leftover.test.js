// test/pipeline/start-leftover.test.js: starting a session, the patches the last try of its
// stage left. Apart from start.test.js, which covers profiles, limits and the order.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {leftoverNote} from "../../pipeline/lib/leftover.js";
import {end, issue, world} from "./pass-world.js";

describe("patches left by the last try", () => {
    test("the next start of the same stage gets the copies and the note at the end", async () => {
        const w = world({issues: [issue(25, ["stage:in-progress"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        fs.writeFileSync(path.join(outbox, "75-x.patch"), "diff");
        end(w, outbox, "c25");
        await w.p.pass();
        await w.p.pass();
        assert.equal(w.outboxes.length, 2);
        assert.deepEqual(w.outboxes[1].patches, {from: outbox, names: ["75-x.patch"]});
        const note = leftoverNote(["/outbox/carried/75-x.patch"]);
        assert.ok(w.outboxes[1].prompt.endsWith(`\n\n${note}`));
        assert.equal(w.outboxes[0].patches, undefined);
    });
    test("a start of another stage gets neither", async () => {
        const w = world({issues: [issue(25, ["stage:review"])]});
        w.state.issues[25].leftover = {stage: "build", outbox: "/old", patches: ["75-x.patch"]};
        await w.p.pass();
        assert.equal(w.outboxes[0].patches, undefined);
        assert.doesNotMatch(w.outboxes[0].prompt, /Work left by the last try/);
    });
});
