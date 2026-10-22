# Factory Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host loop that moves GitHub issues through architect, builder, reviewer and QA sessions unattended, each session in its own Docker container, through any harness, until a stop condition Tim gave it is met.

**Architecture:** `bin/pipeline.js` is a Node CLI whose one pass is a function in `pipeline/lib/pass.js`; the pass schedules from a local state file and talks to GitHub through `gh-as ops`. A stage is a container started from `docker/factory/Dockerfile` whose entry point `pipeline/stage.sh` clones from a mirror volume, runs a harness adapter from `pipeline/harness/`, runs the edit hook's checks from outside the session and resumes it on findings, and leaves `result.json` plus request files in an outbox directory the host reads. Tokens come from a small HTTP endpoint on the host that speaks the gh-bot-mint protocol. `bin/board.js`, `bin/digest.js` and `bin/evidence.js` are the board, the Notion checklist and the R2 upload.

**Tech Stack:** Node 24 ES modules with `node:test` (the loop is Node rather than the snake's bash so its state and pass logic are unit-tested and readable; Tim confirmed 2026-10-21); bash for the in-container runner and adapters; Docker 29; `gh` and the gh-personas plugin (`gh-as`, `bot-token`); Claude Code CLI 2.1 (`claude -p`, `--session-id`, `--resume`, `--plugin-dir`, `--max-budget-usd`, stream-json); Notion REST API; Cloudflare R2 object REST API.

**Spec:** `docs/software-factory/loop-design.md` (the design) and `.agents/plans/2026-10-21-code-standard-skill.md` (done first: prompts cite the skill).

## Global Constraints

- The loop never writes to a checkout a person uses: all stage work happens in a container on a clone of `var/pipeline/mirror.git`; the host loop touches only `var/pipeline/` and GitHub.
- Every GitHub write goes through `gh-as <persona>`; the loop's own writes are `gh-as ops`, the board's are `gh-as -`. The repo is `tjlytle/Sozi` (`PIPELINE_REPO`); never sozi-projects/Sozi.
- No App private key enters a container; credentials reach a container as environment variables only; no token is ever printed or logged.
- Labels (from the design): `stage:todo`, `stage:blocked`, `stage:in-progress`, `stage:review`, `stage:qa`, `stage:done`, `stage:parked`, `triage`, `idea`, `working`. Prompts: `stage:todo → plan`, `stage:in-progress → build`, `stage:review → review`, `stage:qa → qa`. Three tries park an issue.
- Defaults: `PIPELINE_PARALLEL=2`, `PIPELINE_SESSION_MINUTES=45`, `PIPELINE_SYNC_MINUTES=10`, `PIPELINE_RATE_LIMIT_BACKOFF_MINUTES=15`, `PIPELINE_MAX_TRIES=3`, resumes per stage 3, idle back-off 30 s doubling to 600 s; models `PIPELINE_MODEL_PLAN=claude-fable-5-1`, the other three `claude-opus-5-5`.
- The obviousness test, verbatim in every prompt: "It is obvious when the fix is contained to the thing noticed, needs no new dependency and no protocol or API change, and you can say in one sentence why it is better."
- Code under `pipeline/lib` and `bin/*.js` follows the standard: ES modules, named exports, JSDoc on exports, `npm run check` green on these new files.
- All new unit tests live in `test/pipeline/` and run in `test/cli/run.sh`.

## Review Focus

- An outbox request from a session is untrusted input: a `done` naming an issue other than the session's, a `label` adding `stage:done`, or a `spawn` with no persona must be refused, logged and not applied. Task 3 pins each.
- The loop restarted while containers run (Ctrl-C, crash): the next start must adopt running containers from the state file, not start duplicates. Task 12 tests `reap` against a container that is still running and one that vanished.
- A GitHub rate-limit reply mid-sync must not lose a `done`: label changes queue in the state file and apply on the next successful sync. Task 4 and Task 12 test the queue.
- `--until` reached while a session runs: no new starts, the session finishes and is judged, then the loop stops and writes the digest. Task 12 tests the ordering.
- A session that edits no file and writes no request (a review that only comments): the outside pass finds nothing, the label read shows a move or not, and no resume is spent. Task 10 tests the empty-change case.

---

### Task 1: Settings and the run-settings block

**Files:**
- Create: `pipeline/config`, `pipeline/lib/config.js`, `pipeline/lib/prompt.js`
- Test: `test/pipeline/config.test.js`, `test/pipeline/prompt.test.js`

**Interfaces:**
- Produces: `loadConfig({root, env}) → Settings` where `Settings` has every `PIPELINE_*` key as a camel-cased property (`parallel`, `sessionMinutes`, `syncMinutes`, `rateLimitBackoffMinutes`, `maxTries`, `softTokens`, `hardTokens`, `sessionBudgetUsd`, `merge`, `plans`, `findings`, `repo`, `human`, `harness`, `harnessFor(stage)`, `modelFor(stage)`, `image`, `notionParent`, `evidence: {account, bucket, token, url}`, `mintPort`, `memory`, `cpus`). Precedence: `env` over `var/pipeline/env` over `pipeline/config` over defaults. `pipeline/config` is `KEY=value` lines, `#` comments, no secrets.
- Produces: `settingsBlock(settings, {issue, stage, epic, until}) → string` and `renderPrompt(template, ctx) → string` (replaces `{N}` with the issue number and prepends the block).

- [ ] **Step 1: Write the failing config test**

```js
// test/pipeline/config.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {loadConfig, parseConfigText} from "../../pipeline/lib/config.js";

describe("pipeline settings", () => {
    test("defaults match the design", () => {
        const s = loadConfig({root: "/nonexistent", env: {}});
        assert.equal(s.parallel, 2);
        assert.equal(s.sessionMinutes, 45);
        assert.equal(s.syncMinutes, 10);
        assert.equal(s.maxTries, 3);
        assert.equal(s.merge, "auto");
        assert.equal(s.plans, "auto");
        assert.equal(s.findings, "obvious");
        assert.equal(s.repo, "tjlytle/Sozi");
        assert.equal(s.modelFor("plan"), "claude-fable-5-1");
        assert.equal(s.modelFor("qa"), "claude-opus-5-5");
        assert.equal(s.harnessFor("build"), "claude");
    });
    test("file values override defaults and env overrides the file", () => {
        const file = parseConfigText("# comment\nPIPELINE_PARALLEL=3\nPIPELINE_HARNESS_REVIEW=codex\n");
        assert.deepEqual(file, {PIPELINE_PARALLEL: "3", PIPELINE_HARNESS_REVIEW: "codex"});
        const s = loadConfig({root: "/nonexistent", env: {PIPELINE_PARALLEL: "1"}, files: [file]});
        assert.equal(s.parallel, 1);
        assert.equal(s.harnessFor("review"), "codex");
        assert.equal(s.harnessFor("build"), "claude");
    });
    test("a bad value is an error naming the key", () => {
        assert.throws(() => loadConfig({root: "/nonexistent", env: {PIPELINE_MERGE: "maybe"}}), /PIPELINE_MERGE/);
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/pipeline/config.test.js`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement `pipeline/lib/config.js`**

`export function parseConfigText(text) → Record<string,string>`; `export function loadConfig({root, env, files}) → Settings` (when `files` is absent, read `pipeline/config` and `var/pipeline/env` under `root` if they exist). Validation: `merge` and `plans` in `auto|review`, `findings` in `obvious|triage`, numbers are integers ≥ 0. `harnessFor(stage)` reads `PIPELINE_HARNESS_<STAGE>` then `PIPELINE_HARNESS`; `modelFor` the same with `PIPELINE_MODEL_`.

- [ ] **Step 4: Write `pipeline/config` with the defaults as comments and the three policy lines set**

```
# Settings of the factory loop; each is overridable by an environment variable of the same
# name, and secrets go in var/pipeline/env (git-ignored), never here.
PIPELINE_MERGE=auto
PIPELINE_PLANS=auto
PIPELINE_FINDINGS=obvious
PIPELINE_REPO=tjlytle/Sozi
PIPELINE_HUMAN=tjlytle
PIPELINE_PARALLEL=2
PIPELINE_SESSION_MINUTES=45
PIPELINE_SYNC_MINUTES=10
PIPELINE_IMAGE=sozi-factory
```

- [ ] **Step 5: Write the failing prompt test**

```js
// test/pipeline/prompt.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {loadConfig} from "../../pipeline/lib/config.js";
import {settingsBlock, renderPrompt} from "../../pipeline/lib/prompt.js";

describe("the run settings block", () => {
    const s = loadConfig({root: "/nonexistent", env: {}});
    test("tells the session the policy in words", () => {
        const b = settingsBlock(s, {issue: 25, stage: "build", epic: 24, until: null});
        assert.match(b, /^## Run settings/);
        assert.match(b, /Issue: #25/);
        assert.match(b, /Merge: auto .*QA merges/);
        assert.match(b, /Plans: auto/);
        assert.match(b, /Findings: obvious/);
        assert.match(b, /Epic: #24/);
        assert.match(b, /Outbox: \/outbox/);
    });
    test("renders a template with the block on top and {N} replaced", () => {
        const out = renderPrompt("Issue #{N} is yours.", s, {issue: 25, stage: "build", epic: null, until: null});
        assert.match(out, /^## Run settings[\s\S]*\n\nIssue #25 is yours\.$/);
    });
});
```

- [ ] **Step 6: Run it, see it fail, implement `pipeline/lib/prompt.js`, run it again**

Run: `node --test test/pipeline/prompt.test.js` → FAIL → implement `settingsBlock` and `renderPrompt` → PASS. The block's `Merge` line copies the design's wording when `auto`: "Merge: auto (QA merges when the gate is green; do not wait for a person)" and when `review`: "Merge: review (stop at approval; a person merges)". `Plans` and `Findings` lines likewise; `Epic` and `Until` lines only when set.

- [ ] **Step 7: Add `test/pipeline` to the runner, widen the lint globs, ignore `var/`, commit**

`test/cli/run.sh`: add `"test/pipeline/*.test.js"`. `bin/check` line 27 and 32 and `package.json` `lint`: add `pipeline/lib` to the ESLint paths and `"pipeline/lib/**/*.js"` to `PRETTIER_PATHS`. `.gitignore`: add `var/`.

```bash
gh-as builder --git add pipeline/config pipeline/lib test/pipeline test/cli/run.sh bin/check package.json .gitignore
gh-as builder --git commit -m "Loop settings and the run settings block"
```

### Task 2: The state file

**Files:**
- Create: `pipeline/lib/state.js`
- Test: `test/pipeline/state.test.js`

**Interfaces:**
- Produces: `emptyState() → State`; `loadState(path) → State`; `saveState(path, state)` (atomic write via rename); `stageOf(labels) → string|null`; `promptFor(stage) → "plan"|"build"|"review"|"qa"|null`; `applyIssue(state, issue)` where `issue` is `{number, title, labels, state: "OPEN"|"CLOSED", body, updatedAt}` (new issue added, labels and stage refreshed, `epic` read from a `Part of #n` line in the body, `blockers` read from a `Blocked by #n[, #m]` line in the newest Implementation Plan comment when supplied as `issue.blockedBy`); `dueIssues(state, settings, now) → number[]` (open, has a prompt, no session, not `working` elsewhere, blockers all closed, ordered by number); `scope(state, {epic}) → number[]`; `isQuiet(state, scopeNumbers) → boolean` (every scoped issue is closed or in `stage:done|stage:parked|triage|idea` or blocked only by issues outside the scope, and no session runs); `recordTry(state, n) → {tries, park: boolean}`; `park(state, n)` (sets `stage:parked` and remembers `parkedFrom`), `wake(state, n) → string` (restores `parkedFrom`, the design's "a parked issue resumes at the stage it parked from"); `queueLabel(state, {issue, add, remove})` and `takeQueuedLabels(state) → ops[]`; `addUsage(state, {tokens, costUsd})`; `ceiling(state, settings) → "ok"|"soft"|"hard"`.
- State shape: `{run: {started, until, epic, tokens, costUsd, stopped, notionPage, mintKey}, issues: {[n]: {title, labels, stage, tries, session, blockers, epic, board, seen}}, sync: {last, backoffUntil}, queued: []}`.

- [ ] **Step 1: Write the failing tests**

```js
// test/pipeline/state.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {emptyState, applyIssue, stageOf, promptFor, dueIssues, scope, isQuiet, recordTry, park, wake, queueLabel, takeQueuedLabels, ceiling} from "../../pipeline/lib/state.js";
import {loadConfig} from "../../pipeline/lib/config.js";

const settings = loadConfig({root: "/nonexistent", env: {PIPELINE_SOFT_TOKENS: "100", PIPELINE_HARD_TOKENS: "200"}});
const issue = (number, labels, extra = {}) => ({number, title: `t${number}`, labels, state: "OPEN", body: "", updatedAt: "2026-10-21T00:00:00Z", ...extra});

describe("state", () => {
    test("labels map to stages and prompts", () => {
        assert.equal(stageOf(["enhancement", "stage:review"]), "stage:review");
        assert.equal(stageOf(["idea"]), null);
        assert.equal(promptFor("stage:todo"), "plan");
        assert.equal(promptFor("stage:blocked"), null);
    });
    test("an issue is added with its epic and blockers", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:blocked"], {body: "Part of #24.\n", blockedBy: [28]}));
        assert.equal(s.issues[25].epic, 24);
        assert.deepEqual(s.issues[25].blockers, [28]);
        assert.equal(s.issues[25].stage, "stage:blocked");
    });
    test("due issues: a prompt, no session, blockers closed, by number", () => {
        const s = emptyState();
        applyIssue(s, issue(30, ["stage:todo"]));
        applyIssue(s, issue(25, ["stage:in-progress"]));
        applyIssue(s, issue(26, ["stage:blocked"], {blockedBy: [28]}));
        applyIssue(s, issue(28, ["stage:done"], {state: "CLOSED"}));
        applyIssue(s, issue(27, ["stage:blocked"], {blockedBy: [25]}));
        s.issues[30].session = {container: "x"};
        assert.deepEqual(dueIssues(s, settings, new Date()), [25, 26]);
    });
    test("scope follows the epic marker; quiet means nothing is due and nothing runs", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:done"], {body: "Part of #24.", state: "CLOSED"}));
        applyIssue(s, issue(31, ["triage"], {body: "Part of #24."}));
        applyIssue(s, issue(40, ["stage:todo"]));
        assert.deepEqual(scope(s, {epic: 24}), [25, 31]);
        assert.equal(isQuiet(s, scope(s, {epic: 24})), true);
        assert.equal(isQuiet(s, scope(s, {})), false);
    });
    test("three tries park; waking resumes at the stage it parked from", () => {
        const s = emptyState();
        applyIssue(s, issue(25, ["stage:review"]));
        assert.deepEqual(recordTry(s, 25), {tries: 1, park: false});
        recordTry(s, 25);
        assert.deepEqual(recordTry(s, 25), {tries: 3, park: true});
        park(s, 25);
        assert.equal(s.issues[25].stage, "stage:parked");
        assert.equal(wake(s, 25), "stage:review");
        assert.equal(s.issues[25].tries, 0);
    });
    test("label operations queue and drain", () => {
        const s = emptyState();
        queueLabel(s, {issue: 25, add: ["stage:review"], remove: ["stage:in-progress"]});
        assert.equal(takeQueuedLabels(s).length, 1);
        assert.equal(takeQueuedLabels(s).length, 0);
    });
    test("ceilings", () => {
        const s = emptyState();
        s.run.tokens = 150;
        assert.equal(ceiling(s, settings), "soft");
        s.run.tokens = 250;
        assert.equal(ceiling(s, settings), "hard");
    });
});
```

- [ ] **Step 2: Run, fail, implement `pipeline/lib/state.js`, run, pass**

Run: `node --test test/pipeline/state.test.js`. The `Part of #n` regex is `/^Part of #(\d+)\b/m`; `Blocked by` parsing is `/^Blocked by\s+((?:#\d+[,\s]*)+)/m` applied by the caller (Task 4) to the plan comment and passed as `blockedBy`.

- [ ] **Step 3: Commit**

```bash
gh-as builder --git add pipeline/lib/state.js test/pipeline/state.test.js
gh-as builder --git commit -m "Loop state: issues, scope, due, tries, queued labels"
```

### Task 3: Outbox requests

**Files:**
- Create: `pipeline/lib/requests.js`
- Test: `test/pipeline/requests.test.js`

**Interfaces:**
- Produces: `readRequests(dir, {issue}) → {accepted: Request[], refused: {file, reason}[]}` reading `req-*.json` files in name order; `validateRequest(obj, {issue}) → Request` throwing with a reason. Request kinds: `{done: {issue, to}}` (`issue` must equal the session's; `to` in `stage:in-progress|stage:review|stage:qa|stage:done|stage:blocked|stage:parked|triage`), `{label: {issue, add?, remove?}}` (never adds `stage:done` or `working`; labels from the design's list only), `{spawn: {persona, prompt, issue?, harness?}}` (persona in the six; prompt non-empty; harness in `claude|codex|opencode` when given), `{note: string}`. Also `readResult(dir) → Result|null` for `result.json`: `{exit, session, usage: {tokensIn, tokensOut, costUsd, turns, status}, changed: string[], commits: string[], resumes}`.

- [ ] **Step 1: Write the failing tests**

```js
// test/pipeline/requests.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {validateRequest} from "../../pipeline/lib/requests.js";

describe("outbox requests", () => {
    test("done moves this issue to a stage", () => {
        assert.deepEqual(validateRequest({done: {issue: 25, to: "stage:review"}}, {issue: 25}), {kind: "done", issue: 25, to: "stage:review"});
    });
    test("done for another issue is refused", () => {
        assert.throws(() => validateRequest({done: {issue: 26, to: "stage:review"}}, {issue: 25}), /issue 26/);
    });
    test("label never adds stage:done or working", () => {
        assert.throws(() => validateRequest({label: {issue: 25, add: ["stage:done"]}}, {issue: 25}), /stage:done/);
        assert.throws(() => validateRequest({label: {issue: 25, add: ["working"]}}, {issue: 25}), /working/);
        assert.equal(validateRequest({label: {issue: 30, add: ["triage"]}}, {issue: 25}).kind, "label");
    });
    test("spawn needs a persona and a prompt", () => {
        assert.throws(() => validateRequest({spawn: {prompt: "x"}}, {issue: 25}), /persona/);
        assert.throws(() => validateRequest({spawn: {persona: "advocate", prompt: "x", harness: "gemini"}}, {issue: 25}), /harness/);
        assert.equal(validateRequest({spawn: {persona: "advocate", prompt: "file it"}}, {issue: 25}).persona, "advocate");
    });
    test("unknown kinds are refused", () => {
        assert.throws(() => validateRequest({merge: {}}, {issue: 25}), /unknown/);
    });
});
```

- [ ] **Step 2: Run, fail, implement, pass**

Run: `node --test test/pipeline/requests.test.js`. `readRequests` wraps `validateRequest` per file and never throws; a malformed JSON file is refused with `reason: "not JSON"`.

- [ ] **Step 3: Commit**

```bash
gh-as builder --git add pipeline/lib/requests.js test/pipeline/requests.test.js
gh-as builder --git commit -m "Outbox requests: done, label, spawn, note, validated"
```

### Task 4: GitHub through gh-as, with back-off

**Files:**
- Create: `pipeline/lib/github.js`
- Test: `test/pipeline/github.test.js`

**Interfaces:**
- Produces: `createGithub({repo, run}) → Github` where `run(cmd: string[], opts) → Promise<{code, stdout, stderr}>` is injectable (default spawns with the gh-personas `bin` on PATH). Methods: `searchIssues() → Issue[]` (one `gh-as ops issue list -R repo --state open --limit 200 --label ... --json number,title,labels,body,updatedAt` per label group, merged; closed issues of the state are refreshed with one `gh-as ops issue list --state closed --search "updated:>=<sync.last>"`), `labelsOf(n)`, `label({issue, add, remove})` (one `issue edit`), `comment(persona, n, body)`, `lastCommentIsHuman(n) → boolean` (`gh-as ops api repos/{repo}/issues/{n}/comments`), `planComment(n) → string|null` (the newest comment whose body starts with `**Implementation Plan**` or `## Implementation Plan`), `blockedBy(text) → number[]`, `openPrFor(n) → {number, headRefName}|null`. Every method throws `RateLimited {resetAt}` when `stderr` matches `/rate limit|API rate limit exceeded|HTTP 403|HTTP 429/`; `resetAt` from `gh-as ops api rate_limit` or now + backoff minutes.

- [ ] **Step 1: Write the failing tests with a fake runner**

```js
// test/pipeline/github.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {createGithub, RateLimited, blockedBy} from "../../pipeline/lib/github.js";

const calls = [];
const fake = replies => async cmd => {
    calls.push(cmd);
    const r = replies.shift();
    return {code: r?.code ?? 0, stdout: r?.stdout ?? "", stderr: r?.stderr ?? ""};
};

describe("github", () => {
    test("label edits go out as ops in one call", async () => {
        calls.length = 0;
        const gh = createGithub({repo: "tjlytle/Sozi", run: fake([{}])});
        await gh.label({issue: 25, add: ["stage:review"], remove: ["stage:in-progress"]});
        assert.deepEqual(calls[0].slice(0, 4), ["gh-as", "ops", "issue", "edit"]);
        assert.ok(calls[0].includes("--add-label") && calls[0].includes("--remove-label"));
        assert.ok(calls[0].includes("tjlytle/Sozi"));
    });
    test("a rate-limit reply becomes RateLimited with a reset time", async () => {
        const gh = createGithub({repo: "tjlytle/Sozi", run: fake([
            {code: 1, stderr: "HTTP 403: API rate limit exceeded"},
            {stdout: JSON.stringify({resources: {core: {reset: 1800000000}}})}
        ])});
        await assert.rejects(gh.labelsOf(25), e => e instanceof RateLimited && e.resetAt.getTime() === 1800000000000);
    });
    test("Blocked by lines are read from a plan", () => {
        assert.deepEqual(blockedBy("## Implementation Plan\n...\nBlocked by #28, #26\n"), [28, 26]);
        assert.deepEqual(blockedBy("no line"), []);
    });
    test("the newest human comment wakes a parked issue", async () => {
        const gh = createGithub({repo: "tjlytle/Sozi", run: fake([{stdout: JSON.stringify([
            {user: {login: "ll-ops[bot]", type: "Bot"}}, {user: {login: "tjlytle", type: "User"}}])}])});
        assert.equal(await gh.lastCommentIsHuman(25), true);
    });
});
```

- [ ] **Step 2: Run, fail, implement `pipeline/lib/github.js`, pass**

Run: `node --test test/pipeline/github.test.js`. The default runner prepends every `~/.claude/plugins/cache/dev-flow/gh-personas/*/bin` to PATH as the snake does.

- [ ] **Step 3: Commit**

```bash
gh-as builder --git add pipeline/lib/github.js test/pipeline/github.test.js
gh-as builder --git commit -m "GitHub through gh-as ops, rate limits as a typed error"
```

### Task 5: The mint endpoint

**Files:**
- Create: `pipeline/lib/mint.js`
- Test: `test/pipeline/mint.test.js`

**Interfaces:**
- Produces: `startMint({port, host, key, repos, mint}) → Promise<{url, close()}>` where `mint(bot, repo) → Promise<string>` is injectable (default runs `bot-token <bot> <repo>` from the plugin bin and returns stdout). Protocol (what `gh-as` sends): `POST /` with `Authorization: Bearer <key>` and body `{"repo": "owner/name", "bot": "<name>"}` → `200 {"token", "expires_at"}`; `401` on a wrong key, `400` on a bad body, `403` when `repo` is not in `repos`, `502` when minting fails. `bot` must be one of the six personas or `claude-dev`. The token never appears in any log line; the endpoint logs `{bot, repo, status}` only.

- [ ] **Step 1: Write the failing test**

```js
// test/pipeline/mint.test.js
import {test, describe, after} from "node:test";
import assert from "node:assert/strict";
import {startMint} from "../../pipeline/lib/mint.js";

describe("the mint endpoint", async () => {
    const asked = [];
    const server = await startMint({port: 0, host: "127.0.0.1", key: "secret", repos: ["tjlytle/Sozi"],
        mint: async (bot, repo) => { asked.push([bot, repo]); return "ghs_fake"; }});
    after(() => server.close());
    const post = (auth, body) => fetch(server.url, {method: "POST", headers: {Authorization: auth}, body: JSON.stringify(body)});

    test("mints for a persona on the locked repo", async () => {
        const r = await post("Bearer secret", {repo: "tjlytle/Sozi", bot: "builder"});
        assert.equal(r.status, 200);
        assert.equal((await r.json()).token, "ghs_fake");
        assert.deepEqual(asked.at(-1), ["builder", "tjlytle/Sozi"]);
    });
    test("refuses a wrong key, another repo and an unknown bot", async () => {
        assert.equal((await post("Bearer nope", {repo: "tjlytle/Sozi", bot: "builder"})).status, 401);
        assert.equal((await post("Bearer secret", {repo: "sozi-projects/Sozi", bot: "builder"})).status, 403);
        assert.equal((await post("Bearer secret", {repo: "tjlytle/Sozi", bot: "root"})).status, 400);
    });
});
```

- [ ] **Step 2: Run, fail, implement with `node:http`, pass**

Run: `node --test test/pipeline/mint.test.js`. `expires_at` is now + 50 minutes in ISO form (`bot-token` caches for an hour).

- [ ] **Step 3: Commit**

```bash
gh-as builder --git add pipeline/lib/mint.js test/pipeline/mint.test.js
gh-as builder --git commit -m "A local mint endpoint speaking the gh-bot-mint protocol"
```

### Task 6: Evidence to R2

**Files:**
- Create: `bin/evidence.js`
- Test: `test/pipeline/evidence.test.js`

**Interfaces:**
- Produces: CLI `node bin/evidence.js put <file> [--key KEY]` printing the public URL; env `PIPELINE_EVIDENCE_ACCOUNT`, `PIPELINE_EVIDENCE_BUCKET`, `PIPELINE_EVIDENCE_TOKEN`, `PIPELINE_EVIDENCE_URL` (public base, no trailing slash), optional `PIPELINE_RUN` and `PIPELINE_ISSUE` for the default key. Exports: `keyFor(file, {run, issue, now}) → string` = `<run or YYYY-MM-DD>/<issue or "run">/<basename>` with a 6-hex suffix from the file's SHA-256 before the extension; `contentTypeOf(file)` for png, jpg, html, txt, json, md; `put({file, key, env, fetch}) → Promise<string>` doing `PUT https://api.cloudflare.com/client/v4/accounts/<account>/r2/buckets/<bucket>/objects/<key>` with `Authorization: Bearer` and the content type, returning `<url>/<key>`.

- [ ] **Step 1: Write the failing tests**

```js
// test/pipeline/evidence.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {keyFor, contentTypeOf, put} from "../../bin/evidence.js";

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ev-")), "shot.png");
fs.writeFileSync(tmp, "png-bytes");
const env = {PIPELINE_EVIDENCE_ACCOUNT: "acc", PIPELINE_EVIDENCE_BUCKET: "b", PIPELINE_EVIDENCE_TOKEN: "t", PIPELINE_EVIDENCE_URL: "https://ev.example"};

describe("evidence", () => {
    test("keys are run/issue/name-hash.ext", () => {
        assert.match(keyFor(tmp, {run: "2026-10-21-1902", issue: 25}), /^2026-10-21-1902\/25\/shot-[0-9a-f]{6}\.png$/);
        assert.match(keyFor(tmp, {now: new Date("2026-10-21T00:00:00Z")}), /^2026-10-21\/run\/shot-[0-9a-f]{6}\.png$/);
        assert.equal(contentTypeOf("a.html"), "text/html");
    });
    test("put PUTs to the R2 object API and returns the public URL", async () => {
        let seen;
        const url = await put({file: tmp, key: "k/shot.png", env, fetch: async (u, init) => { seen = {u, init}; return {ok: true, status: 200}; }});
        assert.equal(url, "https://ev.example/k/shot.png");
        assert.equal(seen.u, "https://api.cloudflare.com/client/v4/accounts/acc/r2/buckets/b/objects/k/shot.png");
        assert.equal(seen.init.method, "PUT");
        assert.equal(seen.init.headers.Authorization, "Bearer t");
        assert.equal(seen.init.headers["Content-Type"], "image/png");
    });
    test("a failed upload is an error with the status, never the token", async () => {
        await assert.rejects(put({file: tmp, key: "k", env, fetch: async () => ({ok: false, status: 401, text: async () => "no"})}), e => /401/.test(e.message) && !/Bearer t/.test(e.message));
    });
});
```

- [ ] **Step 2: Run, fail, implement `bin/evidence.js` (the `main` guard pattern of `bin/check-coverage.js`), pass**

Run: `node --test test/pipeline/evidence.test.js`.

- [ ] **Step 3: Commit**

```bash
gh-as builder --git add bin/evidence.js test/pipeline/evidence.test.js
gh-as builder --git commit -m "bin/evidence: screenshots to R2, URL back"
```

### Task 7: The Notion checklist

**Files:**
- Create: `bin/digest.js`
- Test: `test/pipeline/digest.test.js`

**Interfaces:**
- Produces: CLI `node bin/digest.js start --title T [--parent ID]` (prints the page id), `add --page ID --issue N --text "..." --url URL [--image URL]`, `finish --page ID --summary "..." [--build URL] [--presenter URL]`; env `NOTION_TOKEN`, `PIPELINE_NOTION_PARENT`, `PIPELINE_NOTION_PAGE` (default for `--page`). Exports: `pageRequest({title, parent}) → body` for `POST /v1/pages` (parent `page_id`, title property, a first paragraph "Checklist for the run; the trail is on GitHub"); `entryBlocks({issue, text, url, image, repo}) → block[]` (one `to_do` block whose rich text is `#<issue> <text>` with `#<issue>` linked to the issue URL, plus an `image` block when given); `finishBlocks({summary, build, presenter}) → block[]` (a `callout` with the summary and bookmark links); `notion(method, path, body, {token, fetch})` with `Notion-Version: 2022-06-28`.

- [ ] **Step 1: Write the failing tests**

```js
// test/pipeline/digest.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {pageRequest, entryBlocks, finishBlocks} from "../../bin/digest.js";

describe("digest", () => {
    test("a run page under the parent", () => {
        const b = pageRequest({title: "Factory run 2026-10-21 19:02", parent: "abc"});
        assert.equal(b.parent.page_id, "abc");
        assert.equal(b.properties.title.title[0].text.content, "Factory run 2026-10-21 19:02");
    });
    test("an entry is a to-do with a link to the issue and an optional image", () => {
        const blocks = entryBlocks({issue: 25, text: "Resize the window; previews follow", url: "https://github.com/tjlytle/Sozi/issues/25", image: "https://ev/x.png"});
        assert.equal(blocks[0].type, "to_do");
        assert.equal(blocks[0].to_do.rich_text[0].text.link.url, "https://github.com/tjlytle/Sozi/issues/25");
        assert.equal(blocks[1].type, "image");
        assert.equal(entryBlocks({issue: 25, text: "x", url: "u"}).length, 1);
    });
    test("finish adds the summary and the build links", () => {
        const blocks = finishBlocks({summary: "3 merged, 1 triage", build: "https://b", presenter: "https://p"});
        assert.equal(blocks[0].type, "callout");
        assert.deepEqual(blocks.slice(1).map(b => b.bookmark.url), ["https://b", "https://p"]);
    });
});
```

- [ ] **Step 2: Run, fail, implement `bin/digest.js`, pass**

Run: `node --test test/pipeline/digest.test.js`. `add` and `finish` use `PATCH /v1/blocks/<page>/children`.

- [ ] **Step 3: Verify once against Notion by hand, then commit**

Run (with Tim's token in `var/pipeline/env`): `set -a; . var/pipeline/env; set +a; node bin/digest.js start --title "Digest smoke test"` then `add` and `finish` on the id it prints.
Expected: a page under the parent with one checkbox and a callout; delete it afterwards in Notion.

```bash
gh-as builder --git add bin/digest.js test/pipeline/digest.test.js
gh-as builder --git commit -m "bin/digest: the Notion checklist page per run"
```

### Task 8: Labels and the board

**Files:**
- Create: `bin/board.js`
- Test: `test/pipeline/board.test.js`

**Interfaces:**
- Produces: CLI `node bin/board.js labels` (creates the ten labels with `gh-as ops label create --force`, colours fixed in `LABELS`), `create` (board "Sozi pipeline" via `gh-as -`, columns Triage, Ideas, Todo, Blocked, In progress, Review, QA, Done, Parked; ported from the snake's `bin/board create`), `sync [--all] [--issues n,m]` (the snake's two-way sync, restricted to the given issues unless `--all`; prints `#n board ← label: X` / `#n label ← board: X`), `url`. Exports: `LABELS` (name, colour, description), `stageToColumn(stage|"closed"|"idea"|"triage") → string`, `columnToStage(column) → string|null`, `decide({state, stage, idea, triage, have, boardAt, labelAt}) → {board: column}|{label: {add, remove}}|null` (the snake's "whichever changed last wins" rule as a pure function).

- [ ] **Step 1: Write the failing tests**

```js
// test/pipeline/board.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {LABELS, stageToColumn, columnToStage, decide} from "../../bin/board.js";

describe("board", () => {
    test("the ten labels", () => {
        assert.deepEqual(LABELS.map(l => l.name).sort(), ["idea", "stage:blocked", "stage:done", "stage:in-progress", "stage:parked", "stage:qa", "stage:review", "stage:todo", "triage", "working"]);
    });
    test("stage to column and back", () => {
        assert.equal(stageToColumn("stage:blocked"), "Blocked");
        assert.equal(stageToColumn("triage"), "Triage");
        assert.equal(stageToColumn("closed"), "Done");
        assert.equal(columnToStage("In progress"), "stage:in-progress");
        assert.equal(columnToStage("Ideas"), null);
    });
    test("the label wins unless the card moved after it", () => {
        const base = {state: "OPEN", stage: "stage:review", idea: false, triage: false};
        assert.deepEqual(decide({...base, have: "Todo", boardAt: "2026-10-21T01:00:00Z", labelAt: "2026-10-21T02:00:00Z"}), {board: "Review"});
        assert.deepEqual(decide({...base, have: "QA", boardAt: "2026-10-21T03:00:00Z", labelAt: "2026-10-21T02:00:00Z"}), {label: {add: ["stage:qa"], remove: ["stage:review"]}});
        assert.equal(decide({...base, have: "Review", boardAt: "", labelAt: ""}), null);
    });
});
```

- [ ] **Step 2: Run, fail, implement `bin/board.js`, pass**

Run: `node --test test/pipeline/board.test.js`. The GraphQL item fetch runs only in `--all`; `--issues` looks each item up by the `board` id in the state file passed as `--state var/pipeline/state.json`, falling back to one `item-add` for an unknown issue.

- [ ] **Step 3: Commit**

```bash
gh-as builder --git add bin/board.js test/pipeline/board.test.js
gh-as builder --git commit -m "bin/board: labels, the board and a per-issue sync"
```

### Task 9: Prompts, allow list, prompt test

**Files:**
- Create: `pipeline/plan.md`, `pipeline/build.md`, `pipeline/review.md`, `pipeline/qa.md`, `pipeline/spawn.md`, `pipeline/allow.txt`
- Test: `test/pipeline/prompts.test.js`

**Interfaces:**
- Produces: the five prompt files the loop renders with `renderPrompt` (Task 1); every one ends by writing a `done` request (the exact instruction: "Finish by writing `/outbox/req-done.json` with `{"done": {"issue": {N}, "to": "<label>"}}`"), tells the persona to load the `code-standard` skill (Claude) or read `.claude/skills/code-standard/SKILL.md` (others), names `.agents/tmp/` as the only place for temporary files, contains the obviousness test verbatim, the decide-and-record rule, the `Part of #<epic>` line for any issue it files ("copy the `Part of` line of the issue you are on"), `gh-as <persona>` for every write, and never the string `code-standard.md`.
- Per prompt: `plan.md` (architect): read the issue and the epic; the Implementation Plan comment with headings Behaviour, Scenarios, Shape, Tests, Dependencies, Decisions taken, Blocked by; the thin-issue rule (post what is needed, `done` to `triage`); `Blocked by #n` sets `done` to `stage:blocked`; otherwise `done` to `stage:in-progress`; no code. `build.md` (builder): branch `{N}-<slug>` from `origin/master` in `/work`; the feature file first; `bin/check`, `npm test`, `npm run test:features`, `check:pr`, `check:coverage`, `check:deps`; commits and push as builder; draft PR from the template with `Closes #{N}`; `done` to `stage:review`; a return from review or QA resumes the branch. `review.md` (reviewer): read only; approve or request changes; file improvements as `idea` issues or, when obvious, as `stage:todo`; `done` to `stage:qa` or `stage:in-progress`. `qa.md`: merge master into the branch first (the talk's lesson); run every check; screenshots with Playwright for a UI change, uploaded with `node bin/evidence.js put`; one QA comment per 6.3; approval = the comment; when every job green on master is green on the PR and the reviewer approved: `gh-as builder pr merge --squash --delete-branch`, `node bin/digest.js add ...`, `done` to `stage:done`; else `done` to `stage:in-progress` with the output. `spawn.md`: the generic prompt for a `spawn` request; `{PROMPT}` is the requester's text and `{PERSONA}` the persona.
- `pipeline/allow.txt`: the snake's list with `bin/play`, `battlesnake`, `make`, `docker` lines removed and these added: `Bash(npm *)`, `Bash(npx *)`, `Bash(node *)`, `Bash(bin/check*)`, `Bash(python3 .claude/hooks/*)`, `Bash(xvfb-run *)`, `Bash(curl *)`.

- [ ] **Step 1: Write the failing test**

```js
// test/pipeline/prompts.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const OBVIOUS = "It is obvious when the fix is contained to the thing noticed, needs no new dependency and no protocol or API change, and you can say in one sentence why it is better.";
const prompts = ["plan", "build", "review", "qa"].map(p => [p, fs.readFileSync(`pipeline/${p}.md`, "utf8")]);

describe("stage prompts", () => {
    for (const [name, text] of prompts) {
        test(`${name}: done request, skill, obviousness, persona writes, no record`, () => {
            assert.match(text, /\/outbox\/req-done\.json/);
            assert.match(text, /"done": \{"issue": \{N\}/);
            assert.match(text, /code-standard/);
            assert.doesNotMatch(text, /code-standard\.md/);
            assert.ok(text.includes(OBVIOUS), "obviousness test verbatim");
            assert.match(text, /gh-as (architect|builder|reviewer|qa)/);
            assert.match(text, /Part of #/);
            assert.match(text, /\.agents\/tmp\//);
        });
    }
    test("the allow list has the project's commands and no docker", () => {
        const allow = fs.readFileSync("pipeline/allow.txt", "utf8");
        for (const line of ["Bash(npm *)", "Bash(npx *)", "Bash(bin/check*)", "Bash(gh-as *)", "Bash(xvfb-run *)"]) {
            assert.ok(allow.includes(line), line);
        }
        assert.doesNotMatch(allow, /docker/);
    });
});
```

- [ ] **Step 2: Run, fail, write the prompts and the allow list, pass**

Run: `node --test test/pipeline/prompts.test.js`. Port the snake's wording where it still fits (the "read the trail" step, "one review per visit, terse, lead with the verdict", "do not fix code" in QA).

- [ ] **Step 3: Commit**

```bash
gh-as builder --git add pipeline/*.md pipeline/allow.txt test/pipeline/prompts.test.js
gh-as builder --git commit -m "Stage prompts and the allow list for this repo"
```

### Task 10: The in-container runner and the outside hook pass

**Files:**
- Create: `pipeline/stage.sh`, `pipeline/hooks-outside.sh`
- Test: `test/pipeline/hooks-outside.test.js`

**Interfaces:**
- Produces: `pipeline/hooks-outside.sh <checkout> <start-sha> <report-file>`: lists files changed since `<start-sha>` (tracked and untracked) under the hook's checked directories and extensions, runs `bin/check FILE` and `python3 .claude/hooks/check-file.py --advise FILE` on each, writes the combined output to `<report-file>` prefixed with the line `The edit hook would have told you:`; exits 0 when the report is empty, 1 otherwise; the report is empty when nothing changed.
- Produces: `pipeline/stage.sh <issue> <stage>` run inside the container with env `PIPELINE_REPO`, `PIPELINE_HARNESS`, `PIPELINE_MODEL`, `PIPELINE_SESSION_BUDGET_USD`, `PIPELINE_MAX_RESUMES` (3), the credentials, and `/outbox` holding `prompt.md`, `allow.txt`. It: clones `/mirror` to `/work`, sets `origin` to `https://github.com/$PIPELINE_REPO.git`, fetches, checks out the issue's branch (`git ls-remote --heads origin "<issue>-*"`, first match) or `master`; links `/cache/node_modules` when `/cache/lock-sha` matches `package-lock.json`, else `npm ci`; creates `/work/.agents/tmp`; records `start-sha`; runs `pipeline/harness/$PIPELINE_HARNESS run --prompt /outbox/prompt.md --model ... --allow /outbox/allow.txt --checkout /work --out /outbox`; then up to `PIPELINE_MAX_RESUMES` times: runs `hooks-outside.sh`, and when the report is non-empty and differs from the previous report, runs the harness `resume --session $(cat /outbox/session) --message <report> ...`; finally writes `/outbox/result.json` (`exit`, `session`, `usage` copied from `/outbox/usage.json`, `changed`, `commits` from `git log --oneline start-sha..HEAD`, `resumes`).

- [ ] **Step 1: Write the failing test for the outside pass**

```js
// test/pipeline/hooks-outside.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
const run = (cwd, cmd, args) => execFileSync(cmd, args, {cwd, encoding: "utf8"});

function scratch() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-"));
    run(root, "git", ["clone", "-q", "--shared", root, dir]);
    fs.symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
    return dir;
}

describe("the outside hook pass", () => {
    test("nothing changed: empty report, exit 0", () => {
        const dir = scratch();
        const sha = run(dir, "git", ["rev-parse", "HEAD"]).trim();
        const report = path.join(dir, "report.txt");
        execFileSync("bash", [path.join(root, "pipeline/hooks-outside.sh"), dir, sha, report]);
        assert.equal(fs.readFileSync(report, "utf8"), "");
    });
    test("a bad new file: the report names it and the exit is 1", () => {
        const dir = scratch();
        const sha = run(dir, "git", ["rev-parse", "HEAD"]).trim();
        fs.writeFileSync(path.join(dir, "src/js/bad.js"), "window.x = 1\n");
        const report = path.join(dir, "report.txt");
        assert.throws(() => execFileSync("bash", [path.join(root, "pipeline/hooks-outside.sh"), dir, sha, report]), /status 1/);
        const text = fs.readFileSync(report, "utf8");
        assert.match(text, /^The edit hook would have told you:/);
        assert.match(text, /src\/js\/bad\.js/);
    });
});
```

- [ ] **Step 2: Run, fail, write `pipeline/hooks-outside.sh`, pass**

Run: `node --test test/pipeline/hooks-outside.test.js`. Reuse the hook's `CHECKED_DIRS` and `CHECKED_EXT` by calling `python3 .claude/hooks/check-file.py --advise` which already filters; the `bin/check FILE` call is skipped for files `bin/check` does not know (same filter as the hook: dirs `src test bin config .github`, the hook's extension list).

- [ ] **Step 3: Write `pipeline/stage.sh` as specified in Interfaces**

No unit test; Task 11's fake harness and Task 14's image smoke test exercise it. It must `set -u`, write `result.json` even when the harness fails (trap on EXIT), and never echo an environment variable.

- [ ] **Step 4: Commit**

```bash
gh-as builder --git add pipeline/stage.sh pipeline/hooks-outside.sh test/pipeline/hooks-outside.test.js
gh-as builder --git commit -m "The in-container stage runner with hooks from the outside"
```

### Task 11: Harness adapters

**Files:**
- Create: `pipeline/harness/README.md`, `pipeline/harness/claude`, `pipeline/harness/codex`, `pipeline/harness/opencode`
- Test: `test/pipeline/harness.test.js`, `test/fixtures/pipeline/fake-claude` (a bash script)

**Interfaces:**
- Contract (in the README, verbatim for every adapter): `run --prompt FILE --model M --allow FILE --checkout DIR --out DIR` and `resume --session ID --message FILE --model M --allow FILE --checkout DIR --out DIR`; stdout is the log; on exit the adapter has written `DIR/session` (the id) and `DIR/usage.json` as `{"tokensIn", "tokensOut", "costUsd", "turns", "status"}` with `status` one of `ok|error|rate-limited|budget|unsupported`; exit 0 when the session ended on its own, 69 when the adapter is a stub (`status: unsupported`), 75 when rate-limited.
- `claude`: `run` generates a UUID, executes `${CLAUDE_BIN:-claude} -p "$(cat prompt)" --session-id ID --model M --permission-mode acceptEdits --allowedTools <lines of allow> --output-format stream-json --verbose --max-budget-usd ${PIPELINE_SESSION_BUDGET_USD:-0} --plugin-dir /opt/gh-personas` (budget flag only when non-zero) in `DIR`, pipes through the snake's `live` jq filter for the log and `tee`s the raw stream to `OUT/stream.jsonl`; parses the final `result` event for `total_cost_usd`, `usage.input_tokens`, `usage.output_tokens`, `num_turns`, `is_error`; `status` is `rate-limited` when the result or any error text matches `/rate limit|429|overloaded/i`, `budget` when `subtype` matches `/budget/`, `error` when `is_error`. `resume` is the same command with `--resume ID` and the message file as the prompt.
- `codex` and `opencode`: write `status: unsupported`, print the contract line and exit 69; the README lists what each needs (`codex exec --json -C DIR`, `codex exec resume`; `opencode run`), for the next builder, and holds the hook-equivalent text a hookless adapter prepends to every prompt: "This harness has no edit hook. After every file you write, run `bin/check <file>` and `python3 .claude/hooks/check-file.py --advise <file>` and act on the output; the loop runs the same checks after you finish and will hand you anything you missed. Every GitHub write goes through `gh-as <persona>`; never bare `gh` or `git push`."

- [ ] **Step 1: Write the failing test with a fake `claude`**

`test/fixtures/pipeline/fake-claude`: a bash script that records its arguments to `$FAKE_ARGS`, prints two stream-json lines (an `assistant` text event and a `result` event with `total_cost_usd: 0.12, usage: {input_tokens: 100, output_tokens: 20}, num_turns: 3, is_error: false, session_id` from `--session-id`), and exits 0.

```js
// test/pipeline/harness.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf8"}).trim();
const fake = path.join(root, "test/fixtures/pipeline/fake-claude");

describe("harness adapters", () => {
    test("claude: run writes session and usage from the stream", () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-"));
        fs.writeFileSync(path.join(out, "prompt.md"), "hello");
        fs.writeFileSync(path.join(out, "allow.txt"), "Read\nBash(npm *)\n");
        const args = path.join(out, "args");
        const r = spawnSync("bash", [path.join(root, "pipeline/harness/claude"), "run", "--prompt", path.join(out, "prompt.md"), "--model", "m", "--allow", path.join(out, "allow.txt"), "--checkout", out, "--out", out], {env: {...process.env, CLAUDE_BIN: fake, FAKE_ARGS: args}, encoding: "utf8"});
        assert.equal(r.status, 0, r.stderr);
        const usage = JSON.parse(fs.readFileSync(path.join(out, "usage.json"), "utf8"));
        assert.deepEqual(usage, {tokensIn: 100, tokensOut: 20, costUsd: 0.12, turns: 3, status: "ok"});
        assert.match(fs.readFileSync(path.join(out, "session"), "utf8"), /^[0-9a-f-]{36}\n?$/);
        const seen = fs.readFileSync(args, "utf8");
        assert.match(seen, /--allowedTools Read Bash\(npm \*\)/);
        assert.match(seen, /--permission-mode acceptEdits/);
    });
    test("stubs exit 69 and say so", () => {
        for (const name of ["codex", "opencode"]) {
            const out = fs.mkdtempSync(path.join(os.tmpdir(), "hz-"));
            const r = spawnSync("bash", [path.join(root, `pipeline/harness/${name}`), "run", "--out", out], {encoding: "utf8"});
            assert.equal(r.status, 69);
            assert.equal(JSON.parse(fs.readFileSync(path.join(out, "usage.json"), "utf8")).status, "unsupported");
        }
    });
});
```

- [ ] **Step 2: Run, fail, write the three adapters and the README, pass**

Run: `node --test test/pipeline/harness.test.js`. Mark the adapters executable.

- [ ] **Step 3: Commit**

```bash
gh-as builder --git add pipeline/harness test/pipeline/harness.test.js test/fixtures/pipeline
gh-as builder --git commit -m "Harness adapters: claude working, codex and opencode stubs"
```

### Task 12: Sandbox, pass and the CLI

**Files:**
- Create: `pipeline/lib/sandbox.js`, `pipeline/lib/pass.js`, `bin/pipeline.js`
- Modify: `package.json` (`"pipeline": "node bin/pipeline.js"`), `CLAUDE.md` (Build section: one line each for `npm run pipeline -- --once`, `--until`, `--epic`, `--status`)
- Test: `test/pipeline/sandbox.test.js`, `test/pipeline/pass.test.js`

**Interfaces:**
- `pipeline/lib/sandbox.js`: `createSandbox({settings, root, run}) → Sandbox` with `refreshMirror()` (`git clone --mirror` once into `var/pipeline/mirror.git`, then `git remote update --prune`), `buildImage()` (`docker build -t <image> --build-context ghp=<plugin dir> docker/factory`), `startArgs({issue, stage, outbox, mintUrl, mintKey, env}) → string[]` (pure: the `docker run -d --name factory-<issue>-<stage>-<hhmm> --add-host=host.docker.internal:host-gateway --memory --cpus -v mirror:/mirror:ro -v outbox:/outbox -e ... <image> /pipeline/stage.sh <issue> <stage>` argument list; credentials passed as `-e NAME` with no value so Docker reads them from the loop's environment and they never appear in `ps`), `start(opts) → containerId`, `status(container) → "running"|"exited"|"gone"`, `stop(container)`, `remove(container)`, `prepareOutbox({issue, stage, prompt, allow}) → dir` (writes `prompt.md`, `allow.txt` under `var/pipeline/out-<issue>-<stage>-<time>/`).
- `pipeline/lib/pass.js`: `createPass({settings, state, github, sandbox, board, digest, clock, log}) → {pass(): Promise<Summary>}` with `Summary = {started: number[], finished: number[], moved: [n, from, to][], parked: number[], stopped: string|null}`. Order inside `pass()`: `reap()` (for every issue with a session: `status`; `exited` or `gone` → `finish(n)`; `running` past `sessionMinutes` → `stop` then `finish`), `refreshMirror`, `syncIfDue()` (when `clock.now() >= sync.last + syncMinutes` and not in backoff: `searchIssues` → `applyIssue` each, `blockedBy(planComment)` (the function imported from `github.js`) for `stage:blocked` issues, `lastCommentIsHuman` for parked ones (then `wake` from `state.js`), drain queued labels, `board.sync(changed)`; `RateLimited` sets `sync.backoffUntil`), `unblock()` and `wake()` from state, `stopCheck()` (`until` passed → `noStarts`; hard ceiling → `noStarts`; `isQuiet(scope)` and no sessions → `stopped = reason`), `start()` (while running < parallel, or < 1 past the soft ceiling: pop `dueIssues`, render the prompt, `prepareOutbox`, `queueLabel working`, `sandbox.start`, record `session`), `saveState`. `finish(n)`: read `result.json` and the requests; `addUsage`; apply accepted requests (`done` → `label` (queued when backoff) and state stage; `label` → the same; `spawn` → push to `state.run.spawns` for `start()` to pick up as a session with `spawn.md`; `note` → log and `digest.add` with no checkbox); refused requests → log; when no `done`: one `labelsOf` read; unchanged stage → `recordTry` → park via `comment(ops, ...)` with the log tail and label `stage:parked` on the third; `usage.status === "rate-limited"` → `sync.backoffUntil = now + backoff`; remove the `working` label; `sandbox.remove`; `session = null`.
- `bin/pipeline.js`: `watch` (default; back-off 30 s doubling to 600 s while a pass started or finished nothing), `--once`, `<#>` (one issue, foreground, waits for its container), `--status`, `--digest` (finish the run's page), `--build-image`, `--until <duration|HH:MM>`, `--epic <#>`, `--harness <name>`; on start: `loadConfig`, `loadState` (or `emptyState` with `run.started`), `startMint` on `settings.mintPort` bound to the Docker bridge address with a fresh `run.mintKey`, `digest.start` once per run; on stop: `digest.finish`, print the reason, exit 0; SIGINT: save state and exit, containers keep running.

- [ ] **Step 1: Write the failing sandbox test (pure parts)**

```js
// test/pipeline/sandbox.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {createSandbox} from "../../pipeline/lib/sandbox.js";
import {loadConfig} from "../../pipeline/lib/config.js";

describe("sandbox", () => {
    const settings = loadConfig({root: "/nonexistent", env: {PIPELINE_MEMORY: "6g", PIPELINE_CPUS: "2"}});
    const sb = createSandbox({settings, root: "/repo", run: async () => ({code: 0, stdout: "", stderr: ""})});
    test("docker run arguments: mounts, limits, env by name, no values", () => {
        const args = sb.startArgs({issue: 25, stage: "build", outbox: "/repo/var/pipeline/out-25-build-1902", mintUrl: "http://host.docker.internal:7311/", mintKey: "k"});
        assert.equal(args[0], "run");
        assert.ok(args.includes("--memory") && args[args.indexOf("--memory") + 1] === "6g");
        assert.ok(args.includes("/repo/var/pipeline/mirror.git:/mirror:ro"));
        assert.ok(args.includes("/repo/var/pipeline/out-25-build-1902:/outbox"));
        assert.ok(args.includes("GH_MINT_URL=http://host.docker.internal:7311/"));
        assert.ok(args.includes("CLAUDE_CODE_OAUTH_TOKEN"), "passed by name only");
        assert.ok(!args.some(a => a.startsWith("CLAUDE_CODE_OAUTH_TOKEN=")));
        assert.deepEqual(args.slice(-3), ["sozi-factory", "/pipeline/stage.sh", "25", "build"].slice(-3));
        assert.match(args[args.indexOf("--name") + 1], /^factory-25-build-/);
    });
});
```

- [ ] **Step 2: Run, fail, implement `pipeline/lib/sandbox.js`, pass**

Run: `node --test test/pipeline/sandbox.test.js`.

- [ ] **Step 3: Write the failing pass tests with fakes**

```js
// test/pipeline/pass.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createPass} from "../../pipeline/lib/pass.js";
import {emptyState, applyIssue} from "../../pipeline/lib/state.js";
import {loadConfig} from "../../pipeline/lib/config.js";

function world({issues = [], now = Date.parse("2026-10-21T19:00:00Z"), env = {}} = {}) {
    const settings = loadConfig({root: "/nonexistent", env});
    const state = emptyState();
    state.run.started = new Date(now).toISOString();
    for (const i of issues) applyIssue(state, i);
    const calls = [];
    const containers = {};
    const github = {
        searchIssues: async () => issues, labelsOf: async n => state.issues[n].labels,
        label: async op => calls.push(["label", op]), comment: async (...a) => calls.push(["comment", ...a]),
        planComment: async () => null, lastCommentIsHuman: async () => false, openPrFor: async () => null
    };
    const sandbox = {
        refreshMirror: async () => {}, prepareOutbox: () => fs.mkdtempSync(path.join(os.tmpdir(), "ob-")),
        start: async o => { const id = `c${o.issue}`; containers[id] = "running"; calls.push(["start", o.issue, o.stage]); return id; },
        status: async id => containers[id] ?? "gone", stop: async id => { containers[id] = "exited"; }, remove: async () => {}
    };
    const board = {sync: async () => {}};
    const digest = {add: async () => {}, finish: async () => {}};
    const clock = {now: () => now, advance: ms => { now += ms; }};
    const p = createPass({settings, state, github, sandbox, board, digest, clock, log: () => {}});
    return {p, state, calls, containers, clock};
}
const issue = (number, labels, extra = {}) => ({number, title: `t${number}`, labels, state: "OPEN", body: "", updatedAt: "2026-10-21T00:00:00Z", ...extra});

describe("a pass", () => {
    test("starts due issues up to the parallel limit, as working", async () => {
        const w = world({issues: [issue(25, ["stage:todo"]), issue(26, ["stage:in-progress"]), issue(27, ["stage:todo"])]});
        const s = await w.p.pass();
        assert.deepEqual(s.started, [25, 26]);
        assert.deepEqual(w.calls.filter(c => c[0] === "label").map(c => c[1]), [{issue: 25, add: ["working"], remove: []}, {issue: 26, add: ["working"], remove: []}]);
    });
    test("a finished session with a done request moves the issue and frees the slot", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        fs.writeFileSync(path.join(outbox, "result.json"), JSON.stringify({exit: 0, session: "s", usage: {tokensIn: 10, tokensOut: 5, costUsd: 0.01, turns: 2, status: "ok"}, changed: [], commits: [], resumes: 0}));
        fs.writeFileSync(path.join(outbox, "req-done.json"), JSON.stringify({done: {issue: 25, to: "stage:in-progress"}}));
        w.containers.c25 = "exited";
        const s = await w.p.pass();
        assert.deepEqual(s.moved, [[25, "stage:todo", "stage:in-progress"]]);
        assert.equal(w.state.issues[25].stage, "stage:in-progress");
        assert.equal(w.state.run.tokens, 15);
        assert.deepEqual(s.started, [25], "the next stage starts in the same pass");
    });
    test("no done and no label move: a try; three tries park with a comment", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        for (let i = 0; i < 3; i++) {
            await w.p.pass();
            fs.writeFileSync(path.join(w.state.issues[25].session.outbox, "result.json"), JSON.stringify({exit: 1, session: "s", usage: {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 0, status: "error"}, changed: [], commits: [], resumes: 0}));
            w.containers.c25 = "exited";
            await w.p.pass();
        }
        assert.ok(w.calls.some(c => c[0] === "comment" && /parking/.test(c[3])));
        assert.equal(w.state.issues[25].stage, "stage:parked");
    });
    test("a running session past the cap is stopped and counts as a try", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        w.clock.advance(46 * 60 * 1000);
        await w.p.pass();
        assert.equal(w.state.issues[25].tries, 1);
        assert.equal(w.state.issues[25].session, null);
    });
    test("--until: no starts after it, stop once sessions finish", async () => {
        const w = world({issues: [issue(25, ["stage:todo"]), issue(26, ["stage:todo"])], env: {PIPELINE_PARALLEL: "1"}});
        w.state.run.until = new Date(w.clock.now() + 1000).toISOString();
        await w.p.pass();
        w.clock.advance(2000);
        let s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.equal(s.stopped, null, "25 still runs");
        fs.writeFileSync(path.join(w.state.issues[25].session.outbox, "result.json"), JSON.stringify({exit: 0, session: "s", usage: {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 1, status: "ok"}, changed: [], commits: [], resumes: 0}));
        fs.writeFileSync(path.join(w.state.issues[25].session.outbox, "req-done.json"), JSON.stringify({done: {issue: 25, to: "stage:in-progress"}}));
        w.containers.c25 = "exited";
        s = await w.p.pass();
        assert.match(s.stopped, /until/);
    });
    test("quiet scope stops the run", async () => {
        const w = world({issues: [issue(25, ["stage:done"], {state: "CLOSED"}), issue(31, ["triage"])]});
        const s = await w.p.pass();
        assert.match(s.stopped, /nothing is due/);
    });
    test("a refused request is logged and not applied", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        fs.writeFileSync(path.join(outbox, "result.json"), JSON.stringify({exit: 0, session: "s", usage: {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 1, status: "ok"}, changed: [], commits: [], resumes: 0}));
        fs.writeFileSync(path.join(outbox, "req-1.json"), JSON.stringify({label: {issue: 25, add: ["stage:done"]}}));
        w.containers.c25 = "exited";
        await w.p.pass();
        assert.ok(!w.calls.some(c => c[0] === "label" && c[1].add.includes("stage:done")));
    });
    test("a rate-limited label change is queued and applied on the next sync", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        const outbox = w.state.issues[25].session.outbox;
        fs.writeFileSync(path.join(outbox, "result.json"), JSON.stringify({exit: 0, session: "s", usage: {tokensIn: 0, tokensOut: 0, costUsd: 0, turns: 1, status: "ok"}, changed: [], commits: [], resumes: 0}));
        fs.writeFileSync(path.join(outbox, "req-done.json"), JSON.stringify({done: {issue: 25, to: "stage:in-progress"}}));
        w.containers.c25 = "exited";
        w.state.sync.backoffUntil = new Date(w.clock.now() + 60000).toISOString();
        await w.p.pass();
        assert.equal(w.state.queued.length >= 1, true);
        assert.equal(w.state.issues[25].stage, "stage:in-progress", "state moves even while GitHub waits");
        w.clock.advance(11 * 60 * 1000);
        await w.p.pass();
        assert.equal(w.state.queued.length, 0);
    });
    test("a restart adopts a still-running container instead of starting a second", async () => {
        const w = world({issues: [issue(25, ["stage:todo"])]});
        await w.p.pass();
        const s = await w.p.pass();
        assert.deepEqual(s.started, []);
        assert.equal(w.calls.filter(c => c[0] === "start").length, 1);
    });
});
```

- [ ] **Step 4: Run, fail, implement `pipeline/lib/pass.js`, pass**

Run: `node --test test/pipeline/pass.test.js`. Parking comment text: `Pipeline: the <stage> stage ended <tries> times without moving this issue, so I am parking it. @<human>, the log tail:` followed by the last 20 lines of `<outbox>/log`.

- [ ] **Step 5: Write `bin/pipeline.js` and wire the scripts**

As specified in Interfaces; `--until 6h|90m|07:00` parsed by `parseUntil(text, now) → Date` (export it and add two assertions to `pass.test.js`: `parseUntil("6h", now)` is now + 6 h; `parseUntil("07:00", now)` is the next 07:00). `package.json`: `"pipeline": "node bin/pipeline.js"`. `CLAUDE.md` Build section: the four usage lines.

- [ ] **Step 6: Run everything and commit**

Run: `npm test` → PASS; `npm run check` → no new failures (only the pre-existing cleanup files).

```bash
gh-as builder --git add pipeline/lib/sandbox.js pipeline/lib/pass.js bin/pipeline.js package.json CLAUDE.md test/pipeline
gh-as builder --git commit -m "bin/pipeline: the loop, one pass as a function"
```

### Task 13: The image

**Files:**
- Create: `docker/factory/Dockerfile`, `docker/factory/README.md`
- Modify: `.dockerignore` (create: `node_modules`, `build`, `dist`, `var`, `.git`)

**Interfaces:**
- Produces: image `sozi-factory` from `node:24-bookworm`: apt `git gh jq python3 curl xvfb` plus Electron's and Chromium's libraries (`npx playwright install-deps chromium` covers Chromium; add `libasound2 libgbm1 libgtk-3-0 libnss3 libxss1` for Electron), global npm `@anthropic-ai/claude-code @openai/codex opencode-ai`, `COPY --from=ghp / /opt/gh-personas` (the plugin, so `/opt/gh-personas/bin` is on `PATH` and `--plugin-dir /opt/gh-personas` loads its hooks and skill), `COPY pipeline /pipeline`, `COPY package.json package-lock.json /cache/` then `npm ci --prefix /cache` and `sha256sum /cache/package-lock.json > /cache/lock-sha`, `npx playwright install chromium` into `/cache/ms-playwright` with `PLAYWRIGHT_BROWSERS_PATH` set, a non-root user `factory` owning `/work` and `/cache`, `ENTRYPOINT ["bash"]`.

- [ ] **Step 1: Write the Dockerfile and build it**

Run: `node bin/pipeline.js --build-image`
Expected: image builds; `docker run --rm sozi-factory -c 'claude --version; gh --version | head -1; ls /opt/gh-personas/bin; test -d /cache/node_modules && echo cache-ok'` prints a version for each and `cache-ok`.

- [ ] **Step 2: Smoke the runner with the fake harness**

Run: with `var/pipeline/mirror.git` refreshed (`node bin/pipeline.js --once --dry-run` is not a flag; use `node -e` to call `createSandbox(...).refreshMirror()`), then
```bash
mkdir -p var/pipeline/smoke && printf 'hello' > var/pipeline/smoke/prompt.md && cp pipeline/allow.txt var/pipeline/smoke/
docker run --rm -v "$PWD/var/pipeline/mirror.git:/mirror:ro" -v "$PWD/var/pipeline/smoke:/outbox" -v "$PWD/test/fixtures/pipeline/fake-claude:/usr/local/bin/fake-claude:ro" -e CLAUDE_BIN=fake-claude -e PIPELINE_REPO=tjlytle/Sozi -e PIPELINE_HARNESS=claude -e PIPELINE_MODEL=m sozi-factory /pipeline/stage.sh 25 build
cat var/pipeline/smoke/result.json
```
Expected: the clone, the cache link and the fake session run; `result.json` has `exit: 0`, `usage.status: "ok"`, `changed: []`, `resumes: 0`.

- [ ] **Step 3: Write `docker/factory/README.md` (how to build, what is cached, how to add a harness) and commit**

```bash
gh-as builder --git add docker/factory .dockerignore
gh-as builder --git commit -m "The factory image: Node, Electron, Chromium, gh, the harnesses, the plugin"
```

### Task 14: CI builds the AppImage and publishes the presenter page

**Files:**
- Modify: `.github/workflows/ci.yml:71-99`

**Interfaces:**
- Produces: on `push` to master, after the scenarios: `npx gulp package` → `dist/*.AppImage` uploaded as artifact `appimage-<sha>` (30 days); `node bin/evidence.js put build/features/<fixture>-presenter.sozi.html --key builds/<sha>/presenter.html` with the four `PIPELINE_EVIDENCE_*` repository secrets, and the same for `index.html` of the fixture deck; the job prints both URLs in its summary (`$GITHUB_STEP_SUMMARY`).

- [ ] **Step 1: Edit the workflow**

Add the three steps with `if: github.event_name == 'push'`; the evidence steps `continue-on-error: true` so a missing secret never turns master red (the loop reads the URL from the step summary when present).

- [ ] **Step 2: Verify the YAML and the gulp task locally**

Run: `npx prettier --check .github/workflows/ci.yml && npx gulp package && ls dist/*.AppImage`
Expected: formatted; one AppImage file (a few minutes).

- [ ] **Step 3: Commit**

```bash
gh-as builder --git add .github/workflows/ci.yml
gh-as builder --git commit -m "CI: an AppImage and the presenter page per merge"
```

### Task 15: Documentation and the day-one checks

**Files:**
- Modify: `docs/software-factory/loop-design.md` (the "Builder notes" list: answers to the day-one checks), `docs/software-factory/README.md` (status paragraph), `CLAUDE.md`

- [ ] **Step 1: Run the day-one checks and record the answers in the design**

1. Headless plugin loading: `docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN sozi-factory -c 'cd /tmp && git clone -q /dev/null x 2>/dev/null; claude -p "say ok" --plugin-dir /opt/gh-personas --output-format json'` (with the token in the environment) → does the result show the plugin's hooks loaded (a `gh-as` denial on a bare `git commit` in a second prompt)? Write the answer under "Builder notes".
2. Mobbin inside the container: is the MCP reachable without a display? Write the answer.
3. Does `claude -p` in a fresh clone show a trust prompt? If so, the fix is a `.claude/settings.local.json` written by `stage.sh` or the `--permission-mode`; write what worked.

- [ ] **Step 2: Update the README status and commit**

README: replace the "What remains" sentence with the state after this plan (labels, board, pipeline, image built; what the launch plan still does).

```bash
gh-as builder --git add docs/software-factory CLAUDE.md
gh-as builder --git commit -m "Record the day-one answers and the loop's status"
```
