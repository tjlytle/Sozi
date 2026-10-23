import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {describeIssue, listText, main} from "../../bin/backlog.js";

/**
 * A fake runner that replays canned replies by command prefix and records every command.
 * @param {Record<string, string>} replies - Joined command prefix to stdout.
 * @returns {{run: (cmd: string[]) => Promise<any>, calls: string[][]}} - The runner and its log.
 */
function fake(replies) {
    /** @type {string[][]} */
    const calls = [];
    return {
        calls,
        async run(cmd) {
            calls.push(cmd);
            const line = cmd.join(" ");
            const key = Object.keys(replies)
                .sort((a, b) => b.length - a.length)
                .find(k => line.startsWith(k));
            return {code: 0, stdout: key === undefined ? "" : replies[key], stderr: ""};
        }
    };
}

const SUBS = JSON.stringify([
    {
        number: 147,
        title: "Sub-issue link: treat a duplicate-link reply as linked",
        state: "open",
        labels: [{name: "idea"}],
        user: {login: "ll-architect[bot]"},
        created_at: "2026-10-23T14:01:00Z",
        body: "Chosen against in #120: the REST reply for a duplicate link.\n\nPart of #172"
    },
    {
        number: 164,
        title: "Give stage containers a larger /dev/shm",
        state: "open",
        labels: [{name: "stage:todo"}],
        user: {login: "ll-qa[bot]"},
        created_at: "2026-10-23T14:20:00Z",
        body: "Seen while testing #88: Electron crashes.\n\nPart of #172"
    },
    {
        number: 116,
        title: "Edit hook blocks on old failures",
        state: "open",
        labels: [{name: "bug"}, {name: "triage"}],
        user: {login: "ll-architect[bot]"},
        created_at: "2026-10-23T12:57:00Z",
        body: "While planning #91 the architect saw the hook.\n\nPart of #172"
    },
    {
        number: 140,
        title: "Closed already",
        state: "closed",
        labels: [],
        user: {login: "ll-builder[bot]"},
        created_at: "2026-10-23T13:00:00Z",
        body: "Part of #172"
    }
]);

describe("the backlog", () => {
    test("describeIssue names the kind, the persona and where it came from", () => {
        const [idea, finding, triage] = JSON.parse(SUBS).map(describeIssue);
        assert.deepEqual(idea, {
            number: 147,
            title: "Sub-issue link: treat a duplicate-link reply as linked",
            kind: "idea",
            persona: "architect",
            origin: 120,
            created: "2026-10-23"
        });
        assert.equal(finding.kind, "stage:todo");
        assert.equal(finding.persona, "qa");
        assert.equal(finding.origin, 88);
        assert.equal(triage.kind, "triage");
        assert.equal(triage.origin, null);
    });

    test("list prints the open issues of the backlog grouped by kind", async () => {
        const f = fake({
            "gh api --paginate --slurp repos/tjlytle/Sozi/issues/172/sub_issues": `[${SUBS}]`
        });
        let out = "";
        const code = await main(["list"], {
            env: {PIPELINE_BACKLOG: "172"},
            root: "/nonexistent",
            run: f.run,
            out: t => (out += t)
        });
        assert.equal(code, 0);
        assert.match(out, /^Backlog #172: 3 open/);
        assert.ok(out.indexOf("triage (1)") < out.indexOf("stage:todo (1)"));
        assert.ok(out.indexOf("stage:todo (1)") < out.indexOf("idea (1)"));
        assert.match(out, /#164 +qa +from #88 +Give stage containers a larger \/dev\/shm/);
        assert.doesNotMatch(out, /Closed already/);
    });

    test("list --json prints the described issues", async () => {
        const f = fake({
            "gh api --paginate --slurp repos/tjlytle/Sozi/issues/172/sub_issues": `[${SUBS}]`
        });
        let out = "";
        await main(["list", "--json"], {
            env: {PIPELINE_BACKLOG: "172"},
            root: "/nonexistent",
            run: f.run,
            out: t => (out += t)
        });
        assert.deepEqual(
            JSON.parse(out).map((/** @type {any} */ i) => i.number),
            [116, 164, 147]
        );
    });

    test("move rewrites the Part of line, moves the sub-issue and sets stage:todo, as Tim", async () => {
        const f = fake({
            "gh api repos/tjlytle/Sozi/issues/147": JSON.stringify({
                id: 9147,
                body: "Chosen against in #120.\n\nPart of #172",
                labels: [{name: "idea"}]
            })
        });
        const code = await main(["move", "147", "--epic", "93", "--stage", "todo"], {
            env: {PIPELINE_BACKLOG: "172"},
            root: "/nonexistent",
            run: f.run,
            out: () => {}
        });
        assert.equal(code, 0);
        const lines = f.calls.map(c => c.join(" "));
        assert.ok(
            lines.every(l => !l.startsWith("gh ") || l === "gh api repos/tjlytle/Sozi/issues/147")
        );
        const writes = lines.filter(l => l.startsWith("gh-as - "));
        assert.ok(
            writes.some(
                l =>
                    l.includes("issue edit 147") &&
                    l.includes("--remove-label idea") &&
                    l.includes("--add-label stage:todo")
            )
        );
        assert.ok(
            writes.some(
                l =>
                    l.includes("-X DELETE repos/tjlytle/Sozi/issues/172/sub_issue") &&
                    l.includes("sub_issue_id=9147")
            )
        );
        assert.ok(
            writes.some(
                l =>
                    l.includes("-X POST repos/tjlytle/Sozi/issues/93/sub_issues") &&
                    l.includes("sub_issue_id=9147")
            )
        );
        const edit = f.calls.find(
            c => c.join(" ").includes("issue edit 147") && c.includes("--body")
        );
        assert.ok(edit);
        assert.match(edit[edit.indexOf("--body") + 1], /\n\nPart of #93$/);
    });

    test("close comments the reason and closes as not planned, as Tim", async () => {
        const f = fake({});
        const code = await main(["close", "147", "148", "--reason", "Not worth it now"], {
            env: {PIPELINE_BACKLOG: "172"},
            root: "/nonexistent",
            run: f.run,
            out: () => {}
        });
        assert.equal(code, 0);
        const lines = f.calls.map(c => c.join(" "));
        for (const n of ["147", "148"]) {
            assert.ok(
                lines.includes(
                    `gh-as - issue close ${n} -R tjlytle/Sozi --reason not planned --comment Triaged by Tim: Not worth it now`
                )
            );
        }
    });

    test("listText of an empty backlog says so", () => {
        assert.equal(listText(172, []), "Backlog #172: 0 open\n");
    });

    test("a bad call prints the usage and exits 2", async () => {
        let err = "";
        assert.equal(
            await main(["move", "147"], {
                env: {PIPELINE_BACKLOG: "172"},
                root: "/nonexistent",
                run: fake({}).run,
                err: t => (err += t)
            }),
            2
        );
        assert.match(err, /usage:/);
        assert.equal(
            await main(["list"], {
                env: {},
                root: "/nonexistent",
                run: fake({}).run,
                err: t => (err += t)
            }),
            2
        );
        assert.match(err, /PIPELINE_BACKLOG/);
    });
});
