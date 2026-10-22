/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests of the repo lock: the PreToolUse hook that denies any gh, gh-as or
// git push command whose target repository is not one of the locked ones.
// They spawn python3 on the hook with a JSON payload on stdin.

const {test, describe} = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const path = require("node:path");
const os = require("node:os");

const root = path.resolve(__dirname, "..", "..");
const hook = path.join(root, ".claude", "hooks", "repo-lock.py");

// Built here so that the commands that run these tests never contain it.
const UPSTREAM = ["sozi-projects", "Sozi"].join("/");
const FORK = "tjlytle/Sozi";
const OTHER = "tjlytle/sozi-channel";

/** Run the hook on a command and return its decision.
 *
 * @param {string} command - The Bash command under test.
 * @param {object} [opts] - `cwd` for the payload, `lock` for the locked repositories.
 * @param opts.cwd
 * @param opts.lock
 * @returns {{decision: "allow"|"deny", reason: string}} - What the hook decided.
 */
function decide(command, {cwd = root, lock = [FORK, OTHER]} = {}) {
    const payload = JSON.stringify({tool_name: "Bash", cwd, tool_input: {command}});
    const result = spawnSync("python3", [hook, ...lock], {
        input: payload,
        encoding: "utf8",
        timeout: 10000
    });
    assert.equal(result.status, 0, result.stderr);
    if (result.stdout.trim() === "") {
        return {decision: "allow", reason: ""};
    }
    const out = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(out.permissionDecision, "deny");
    return {decision: "deny", reason: out.permissionDecisionReason};
}

const allow = (command, opts) => assert.equal(decide(command, opts).decision, "allow", command);
const deny = (command, opts) => assert.equal(decide(command, opts).decision, "deny", command);

describe("repo lock: commands that act on no repository", () => {
    test("non-gh commands pass", () => {
        allow("ls -la");
        allow("echo gh");
    });
    test("repo-less gh commands pass", () => {
        allow("gh auth status");
        allow("gh api rate_limit");
        allow("gh api user");
        allow("gh --version");
        allow("gh issue --help");
        allow("gh repo list tjlytle");
        allow(`gh search issues presenter --repo ${FORK}`);
    });
});

describe("repo lock: explicit targets", () => {
    test("a locked repository passes in every spelling", () => {
        allow(`gh issue list -R ${FORK}`);
        allow(`gh-as builder issue create -R ${FORK} --title x --body y`);
        allow(`gh-as claude-dev pr create --repo=${OTHER} -t x -b y`);
        allow(`gh-as - pr merge 18 --squash -R ${FORK}`);
        allow(`gh pr view 18 -R ${FORK} --json mergeable -q .mergeable`);
    });
    test("the upstream is denied in every spelling", () => {
        deny(`gh issue create -R ${UPSTREAM} --title x`);
        deny(`gh issue view -R ${UPSTREAM} 783`);
        deny(`gh pr list -R${UPSTREAM}`);
        deny(`gh pr edit 5 --add-label x --repo ${UPSTREAM}`);
        deny(`gh issue view https://github.com/${UPSTREAM}/issues/783`);
        deny(`gh repo set-default ${UPSTREAM}`);
        deny(`gh repo fork ${UPSTREAM}`);
        deny(`gh repo view ${UPSTREAM}`);
    });
    test("a repository outside the lock is denied even for reads", () => {
        deny("gh issue list -R tjlytle/techbash-snake");
    });
    test("gh repo create is never on a locked repository", () => {
        deny("gh repo create foo --private");
    });
});

describe("repo lock: gh api", () => {
    test("REST paths name their repository", () => {
        allow(`gh api repos/${FORK}/pulls`);
        allow("gh api repos/{owner}/{repo}/pulls");
        deny(`gh api repos/${UPSTREAM}/issues -f title=x`);
    });
    test("graphql is checked for owner and name", () => {
        allow("gh api graphql -f query='{ viewer { login } }'");
        allow(
            `gh api graphql -f query='query { repository(owner:"tjlytle", name:"Sozi") { id } }'`
        );
        deny(
            `gh api graphql -f query='query { repository(owner:"sozi-projects", name:"Sozi") { id } }'`
        );
        deny(
            `gh api graphql -f query='query($o:String!,$n:String!){repository(owner:$o,name:$n){id}}' -f o=x -f owner=sozi-projects -f name=Sozi`
        );
    });
    test("a mutation that names no repository is denied", () => {
        deny(
            `gh api graphql -f query='mutation { addComment(input:{subjectId:"x", body:"y"}) { clientMutationId } }'`
        );
    });
});

describe("repo lock: no -R resolves from the working directory", () => {
    test("this clone resolves to the fork", () => {
        allow("gh issue list");
        allow("gh repo view");
        allow("gh-as builder --push 2-render-export");
    });
    test("a directory that is not a repository is denied", () => {
        deny("gh issue list", {cwd: os.tmpdir()});
    });
    test("cd in the command moves the working directory", () => {
        allow(`cd ${root} && gh issue list`, {cwd: os.tmpdir()});
        deny(`cd ${root} && cd - && gh issue list`, {cwd: os.tmpdir()});
    });
    test("the fork is denied when it is not in the lock", () => {
        const result = decide("gh issue list", {lock: [OTHER]});
        assert.equal(result.decision, "deny");
        assert.match(result.reason, /only acts on tjlytle\/sozi-channel/);
    });
});

describe("repo lock: git push", () => {
    test("origin passes, upstream and foreign URLs do not", () => {
        allow("git status && git push origin 2-render-export");
        allow("git push");
        allow("gh-as builder --git push origin x");
        deny("git push upstream 2-render-export");
        deny(`git push https://github.com/${UPSTREAM}.git main`);
        deny("gh-as builder --git push upstream x");
    });
    test("commits are not pushes", () => {
        allow("gh-as builder --git commit -m x");
    });
});

describe("repo lock: command shapes", () => {
    test("prefixes, pipes, substitutions, loops and newlines are seen through", () => {
        deny(`GH_TOKEN=x gh issue create -R ${UPSTREAM} -t a`);
        deny(`echo $(gh issue list -R ${UPSTREAM})`);
        deny(`gh issue list -R ${UPSTREAM} | head`);
        deny(`gh issue list -R ${UPSTREAM} 2>/dev/null || true`);
        deny(`for i in 1 2; do gh issue view $i -R ${UPSTREAM}; done`);
        deny(`gh issue list -R ${FORK}\ngh issue list -R ${UPSTREAM}`);
    });
    test("the upstream name in text that is not a gh command passes", () => {
        allow(`curl -s https://api.github.com/repos/${UPSTREAM}`);
    });
});

describe("repo lock: fails closed", () => {
    test("no locked repositories denies every repository command", () => {
        const result = decide(`gh issue list -R ${FORK}`, {lock: []});
        assert.equal(result.decision, "deny");
        assert.match(result.reason, /no repositories are locked/);
    });
    test("an unparseable payload is denied", () => {
        const result = spawnSync("python3", [hook, FORK], {input: "nope", encoding: "utf8"});
        assert.equal(result.status, 0);
        assert.match(result.stdout, /could not parse the hook payload/);
    });
});
