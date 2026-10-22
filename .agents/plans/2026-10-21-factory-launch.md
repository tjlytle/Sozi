# Factory Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the standard and the loop on GitHub so the loop can run: the anchor issue, labels, the board, the cleanup issues, the foundation PR, branch protection, the first supervised run.

**Architecture:** Nothing new is coded here; this plan is the sequence of GitHub and host actions that turns the `software-factory` branch into master's foundation, with Tim's hand on the two things only he can do (secrets and the merge). It runs after the skill plan and the loop plan.

**Tech Stack:** `gh-as`, `bin/board.js`, `bin/pipeline.js`, GitHub branch protection, Docker.

**Spec:** `docs/software-factory/loop-design.md` ("Merge and the next look", "One repository", "Cleanups" in the code standard record).

## Global Constraints

- The branch must be renamed `<issue>-software-factory` before the PR: `check:pr` requires `<number>-<slug>`.
- The foundation PR is opened as `builder` and merged by Tim with `gh-as -`; the loop starts on master only after that.
- A CI job is marked required only while it is green on master (standard 1, "Cleanups").
- Tim's prerequisites (Task 0) block Task 5 and Task 6 only; everything else proceeds without them.

## Review Focus

- Transferring the sozi-channel issues while this project's repo lock is active fails; Task 3 runs the transfer from the channel checkout or by Tim, never from this clone.
- A cleanup issue that spans the whole tree (the Prettier reformat) conflicts with every open PR; Task 4 files it as the first `stage:todo` and the others as `stage:blocked` on it.
- The first run must be watched: Task 6 runs `--once` on one scratch issue in the foreground before `watch` is ever started.
- Protection with "require one approving review" blocks QA's merge unless the reviewer App's approval counts; Task 5 verifies with the smoke PR before the loop depends on it.
- Marking `check` required while the cleanups are open would block every PR; Task 5 lists exactly which jobs are green today.

---

### Task 0: What only Tim can provide (collect, do not block on)

- [ ] `claude setup-token` on the host → `CLAUDE_CODE_OAUTH_TOKEN=...` in `var/pipeline/env`.
- [ ] A Notion internal integration with access to a parent page → `NOTION_TOKEN=...` and `PIPELINE_NOTION_PARENT=<page id>` in `var/pipeline/env`.
- [ ] An R2 bucket with a public domain and an API token with Object Read & Write on it → `PIPELINE_EVIDENCE_ACCOUNT`, `PIPELINE_EVIDENCE_BUCKET`, `PIPELINE_EVIDENCE_TOKEN`, `PIPELINE_EVIDENCE_URL` in `var/pipeline/env`, and the same four as repository secrets for CI (`gh-as - secret set`).
- [ ] Confirm all six persona Apps are installed on `tjlytle/Sozi` (`gh-personas mode` shows `bot` for each; a `marker` line means one is missing).

### Task 1: The anchor issue and the branch name

- [ ] **Step 1: File the issue as advocate**

```bash
gh-as advocate issue create -R tjlytle/Sozi --title "Software factory foundation: standard, checks, hooks, loop" --body-file docs/software-factory/README.md
```
Note the number `N`.

- [ ] **Step 2: Post the design and the three plans on it as architect**

Per the trail convention: `loop-design.md`, then each plan, each as its own comment headed `## Plan` with its source path; over 60K characters split across consecutive comments.

- [ ] **Step 3: Rename the branch**

```bash
gh-as builder --git branch -m software-factory N-software-factory
npm run check:pr
```
Expected: `check:pr` passes the branch-name check (it still wants `Closes #N` from a PR body; pass `--body-file` with a line `Closes #N` to see it fully green).

### Task 2: Labels and the board

- [ ] **Step 1: Create the labels and the board**

```bash
node bin/board.js labels
node bin/board.js create
node bin/board.js url
```
Expected: eleven labels on the repo (`gh label list -R tjlytle/Sozi` shows them), a board "Sozi pipeline" with nine columns (tests and build share "In progress"), its URL printed.

- [ ] **Step 2: Label the planned backlog**

Epic #24 gets no stage label. #25 and #28 get `stage:todo`; #26, #27, #29 to #33 get `stage:todo` too (the architect decides the blocking; the issues already say "Part of #24"). #1, #9 and #13 stay unlabelled until Tim decides.

```bash
for n in 25 26 27 28 29 30 31 32 33; do gh-as ops issue edit $n -R tjlytle/Sozi --add-label stage:todo; done
node bin/board.js sync --all
```
Expected: nine cards in Todo.

### Task 3: One repository: the channel issues

- [ ] **Step 1: Transfer the three sozi-channel issues**

From the sozi-channel checkout (its own repo lock applies there) or by Tim in the browser:
```bash
gh issue transfer 7 tjlytle/Sozi -R tjlytle/sozi-channel
gh issue transfer 8 tjlytle/Sozi -R tjlytle/sozi-channel
gh issue transfer 9 tjlytle/Sozi -R tjlytle/sozi-channel
```
Then in this repo, as architect, one comment on each: "Transferred from sozi-channel; the Worker will live under `packages/channel/` once #<move issue> lands." Add `Part of #24` to their bodies if missing.

- [ ] **Step 2: File the move as an issue, not a task**

```bash
gh-as advocate issue create -R tjlytle/Sozi --title "Move the sozi-channel Worker into packages/channel with its history" --body "git subtree add --prefix packages/channel https://github.com/tjlytle/sozi-channel.git <default branch>; wire its checks into bin/check and ci.yml; standard 4 facts for its dependencies. Blocked by the foundation PR. Part of #24." --label triage
```
Tim decides whether a person or the architect does the subtree add.

### Task 4: The cleanup issues

- [ ] **Step 1: File them as advocate, in this order, with the facts from the record**

1. "Reformat the tree with Prettier (standard 1.1)": `bin/check --fix` over `src/js src/css test`; measured 31% of lines; `No test:` waiver for every file; makes the `check` job's Prettier step green. Label `stage:todo`.
2. "ESLint hand fixes (standard 1.2)": the 131 findings by rule; includes the `no-param-reassign` rewrites. `Blocked by #<1>`. Label `stage:todo` (the architect will set `stage:blocked`).
3. "Type errors under checkJs (standard 1.3)": 544 errors, by file; may be split by the architect. `Blocked by #<1>`.
4. "Stylelint fixes (standard 1.4)": BEM renames and token extraction. `Blocked by #<1>`.
5. "Mark the check job required (standard 1, Cleanups)": one-line issue, blocked by all four.

Each body: what the check reports today (paste the counts), the command that shows it, "Part of #N" (the anchor), and "CI stays green when this merges" as the acceptance line.

- [ ] **Step 2: Verify**

Run: `gh issue list -R tjlytle/Sozi --label stage:todo`
Expected: the nine presenter issues plus the five cleanups.

### Task 5: The foundation PR and protection

- [ ] **Step 1: Push and open the PR as builder**

```bash
gh-as builder --push N-software-factory -u
gh-as builder pr create -R tjlytle/Sozi --draft --title "Software factory foundation" --body-file <body>
```
Body from the template: `Closes #N`; What changed: the standard and skill, checks and hooks, CI, the loop, the image; Plan: "As written, see the three plans on #N"; Dependencies: the exact-pinned dev dependencies with the section 4 facts (`npm run check:deps` output); Ideas filed: the cleanup issues; QA: "Tim reviews by hand; CI below."

- [ ] **Step 2: Watch CI and record which jobs are green**

Run: `gh pr checks <pr> -R tjlytle/Sozi --watch`
Expected today: `pr-shape`, `coverage`, `deps` green; `build` green if `npm test` and the scenarios pass on the runner; `check` red (cleanups). Write the list in the PR body's QA section.

- [ ] **Step 3: Tim reviews and merges**

`gh-as - pr review <pr> --approve` then `gh-as - pr merge <pr> --squash` by Tim. Then protection on master, by Tim or as `-`:
```bash
gh-as - api -X PUT repos/tjlytle/Sozi/branches/master/protection --input protection.json
```
with required status checks = the green jobs from Step 2, `required_approving_review_count: 1`, `enforce_admins: false`, `restrictions: null`.

- [ ] **Step 4: Smoke the review path**

Open a tiny PR as builder (a one-line README change on branch `<smoke issue>-smoke`), approve it as `reviewer`, merge it as `builder`.
Expected: the merge is allowed with the reviewer App's approval. If protection refuses, the fix is "Allow specified actors to bypass" for the builder App or dropping the review requirement in favour of the loop's rule; record the outcome in `loop-design.md`.

### Task 6: The first supervised run

- [ ] **Step 1: One issue in the foreground**

```bash
node bin/pipeline.js --build-image
node bin/pipeline.js 25
```
Expected: the architect's container runs, an Implementation Plan comment lands on #25 as `ll-architect[bot]`, the issue moves to `stage:tests` or `stage:blocked`, the outbox shows `result.json` and `req-done.json`, the board card moves. Fix anything that breaks before continuing.

- [ ] **Step 2: One pass, then a short watch**

```bash
node bin/pipeline.js --once
node bin/pipeline.js --until 2h --epic 24
```
Watch the first issue end to end: QA pushes a red feature file and the comment shows it failing, the PR opens as builder with the scenarios green and the unit tests' red run in the body, review runs, QA runs the scenarios in the container and posts evidence with a URL from R2, the merge lands, the Notion page gets its entry.

- [ ] **Step 3: Record what Tim should expect next time he looks**

Add to `docs/software-factory/README.md`: how to start a run, where the state and logs are (`var/pipeline/`), what the Notion page shows, and the three places that need him (`triage`, `idea`, `stage:parked`).
