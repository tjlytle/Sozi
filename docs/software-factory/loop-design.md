# The factory loop: design

Status: design agreed in conversation with Tim on 2026-10-21; this document is what a
builder plans from. The code standard (`code-standard.md`) says how the code looks and
what CI checks; this says how issues move through the personas unattended.

## Intent

Tim files work as GitHub issues, either from a planning session (an epic and its children,
already carrying acceptance criteria and often a plan) or by typing a few lines into a new
issue. He starts the loop in the evening and finds, in the morning:

- a build he can click through, made from exactly what merged overnight;
- a short checklist in Notion of what to try by hand, one or two lines per merged issue,
  with a checkbox per entry and a link back to the issue;
- on each issue, the whole trail in order: the plan, the PR, the review, what QA ran, the
  screenshot, the ideas filed along the way.

What would make him wince: the loop idle at issue three because a question was waiting
on him; the loop working in the checkout he has open; the loop blocked because something
else on the machine held a port or a build directory.

## Goals, non-goals, anti-goals

Goals: unattended progress through the presenter backlog (#24 and its children, then
sozi-channel #7 to #9); every decision recorded where Tim will read it; the loop keeps
going when it has a question; obvious bugs and obvious improvements start on their own.

Non-goals for the first version: running in the cloud (designed for, not built); a
decision model in front of the merge (the required CI checks are the judgment); the
`advocate` persona as a loop stage (it stays an identity for sessions that file issues).

Anti-goals: a stage that waits on a person; a stage that edits a checkout a person is
using; a rule a model can quietly skip (anything that matters is a label the loop reads
or a check CI runs).

## Constraints

- Every GitHub write goes through `gh-as <persona>`; the loop acts as `ops`. The bots are
  installed on `tjlytle/Sozi` (`gh-personas mode`). The repo lock hook denies any write
  outside the fork, inside the loop's sessions too.
- The code standard and its hooks apply inside every stage session: the edit hook runs on
  each file a persona writes, `npm run check`, `check:pr`, `check:deps`,
  `check:coverage` and `test:features` are the checks CI runs.
- Local now. Nothing may block testing on Tim's machine. Each piece is built with the cloud
  shape in mind (see "Cloud path"), and that section lists what changes for it.
- Models: the architect plans on the most capable model (`claude-fable-5-1`); builder,
  reviewer and QA run on the standard one (`claude-opus-5-5`); each overridable by
  environment variable, as in the snake.
- Paper (local MCP) is for planning sessions only; the loop never calls it. Mobbin is
  reachable from anywhere and the loop may use it for UI questions.

## The shape, ported from the snake

`tjlytle/techbash-snake` is the template (`bin/pipeline`, `pipeline/*.md`,
`pipeline/allow.txt`, `bin/board`). What carries over unchanged: labels are the state
machine and the only thing the bots read; one headless `claude -p` session per stage with
a prompt file and a tool allow list; `working` as the loop's lock while a session holds an
issue; a run ends without moving the label counts as a failed try, three tries park the
issue with the log tail; a board mirrors the labels for people and a dragged card moves
the label. What changes is below.

### Stages and labels

| Label | Persona | Prompt | Moves to |
|---|---|---|---|
| `stage:todo` | architect | `pipeline/plan.md`: triage and plan | `stage:in-progress`, or `stage:blocked`, or `triage` |
| `stage:blocked` | nobody | waits for the issues its plan names | `stage:in-progress` when they are closed (the loop checks each pass) |
| `stage:in-progress` | builder | `pipeline/build.md` | `stage:review` |
| `stage:review` | reviewer | `pipeline/review.md` | `stage:qa`, or back to `stage:in-progress` |
| `stage:qa` | qa | `pipeline/qa.md`: scenarios, evidence, merge | `stage:done` (closed by the merge), or back to `stage:in-progress` |
| `stage:done` | | merged | |
| `stage:parked` | | mechanical blocker only (a missing credential, a push the lock denied); `@tjlytle` in one comment | `stage:in-progress` when the newest comment is from a human |
| `triage` | | needs Tim: a non-obvious finding, a user-facing question with no clear better way, an issue too thin to plan | Tim adds `stage:todo` or closes it |
| `idea` | | an alternative the architect chose against, for Tim to weigh | same |
| `working` | ops | a session holds the issue right now | |

There is no `stage:planned`: `Plans: auto` (interview decision), the architect moves a
planned issue straight to `stage:in-progress`.

### Policy lines in `CLAUDE.md`

```
Merge: auto
Plans: auto
Findings: obvious start, the rest triage
```

### Questions do not stop the line

By the time the plan is written, the questions are answered. The architect's plan states
each decision it took and why. Where a real fork exists, the architect picks the better
route and files the alternative as an `idea` issue ("Chosen against in #<n>: ...") so Tim
can weigh it in the morning. A builder, reviewer or QA that meets a decision the plan does
not settle does the same: decide, record it in the PR body or the comment, file the
alternative, keep going. Version control is the safety net; the bias is to act and let
Tim roll back.

Parking is for mechanical blockers only. A parked issue steps aside; the other issues keep
moving.

### Findings sort by obviousness, not by kind

Any persona that notices a bug or an improvement outside its issue files it as its own
issue (the snake's rule) and then applies one test, written the same way in every prompt:

> It is obvious when the fix is contained to the thing noticed, needs no new dependency
> and no protocol or API change, and you can say in one sentence why it is better.

Obvious: label `stage:todo`, and it starts on its own. Not obvious: label `triage`. A
user-facing weakness is not automatically triage: the persona looks at Mobbin for how real
apps handle that moment, and if the better way is clear, it is obvious.

### Dependencies are the architect's

The architect reads the epic and the open issues. When the issue depends on one that has
not merged, the plan says `Blocked by #<n>` (one line, one or more numbers) and the
architect sets `stage:blocked`. Each pass, the loop reads the blocked issues' plans and
moves an issue whose blockers are all closed to `stage:in-progress`. Tim never orders the
backlog.

### Intake

An issue is the intake, whatever made it. The architect's triage on `stage:todo`:

- the issue already carries a plan (a planning session wrote it): verify it fits the code
  as it is today, add what is missing, move on;
- the ask is clear but has no plan: write the plan;
- the ask is too thin to plan: post what is needed, in plain words, and label `triage`.

The Implementation Plan comment keeps the snake's headings adapted to this code:
Behaviour, Scenarios (Gherkin, the ones the feature file will hold), Shape (which files,
which module kind per code-standard 2.1 and 2.2, where it sits relative to the deck and
surface boundary of 2.3), Tests (which feature file and unit tests, the `# covers:` lines),
Dependencies (any package, with the section 4 facts), Decisions taken (and the `idea`
issues filed for the alternatives), Blocked by.

### Sandbox: every stage runs in a container

The loop never touches a checkout a person uses, and stages never contend for ports or
build directories. Each stage runs in a Docker container from an image the repo defines
(`docker/factory/Dockerfile`): Node 24, the Electron and Chromium system libraries,
Xvfb, Playwright's Chromium, `gh`, `git`, `python3`, `jq`, the Claude Code CLI, and the
gh-personas plugin's `bin`. Inside, a fresh checkout of the branch (cloned from a bare
mirror volume the loop keeps current, so a clone costs seconds), `npm ci`, and the stage
prompt run as `claude -p`. The container's only shared state with the host is the mirror
volume (read) and the log directory (write).

Credentials reach the container as environment variables, never as mounted home
directories. The Claude Code token comes from `claude setup-token` on the host, stored
once. GitHub tokens: the host loop mints them (Tim, 2026-10-21: "the factory script
launching the container should mint the right token for that process and pass it in").
`gh-as` has exactly two ways to get a bot token, the local App keys or the mint worker
(`GH_MINT_URL`/`GH_MINT_KEY`), and the keys never enter a container. So the loop speaks
the worker's protocol itself: before each pass it mints one token per persona with
`bot-token` on the host and serves them from a small local endpoint (bound to the Docker
bridge, keyed by a per-run secret), and the container gets `GH_MINT_URL` pointing at it.
No change to the plugin, and the container uses the same path a cloud session uses
against the real worker. When Tim deploys the per-persona worker, the same containers
work unchanged with its URL instead.

**Ceilings** (Tim: limits per agent and per machine, and the loop throttles near a usage
limit). A fixed number of containers at a time (`PIPELINE_PARALLEL`, default two; a build
or QA stage runs an Electron build and Chromium, so the default is sized for a laptop).
Each session has a wall-clock cap (`PIPELINE_SESSION_MINUTES`, default 45; the container
is stopped and the run counts as a failed try) and, on an API key, `--max-budget-usd` per
session. The loop reads every session's result line (tokens and cost from the stream)
and keeps a running total per run: past a soft limit it drops to one container, past a
hard limit it starts nothing more until the morning, and a rate-limit result backs the
loop off for fifteen minutes. The limits are per-run settings (`PIPELINE_SOFT_TOKENS`,
`PIPELINE_HARD_TOKENS`, or USD on an API key); a subscription's own usage window cannot
be queried, so the totals are the loop's own count. Self-started issues are not capped
separately: the container count and the limits bound them.

### Merge and the morning

`Merge: auto`, with the no-regression rule while the gate is still red on old code: a PR
may merge when every CI job that is green on master is green on the PR, and the reviewer
bot has approved it. Branch protection on master requires one approving review (the
reviewer) and the jobs that are green; each cleanup PR that turns a job green also marks
it required (code-standard section 1, "Cleanups"). QA's approval is its evidence comment
(6.3), not a PR review: the qa App cannot submit reviews. QA merges as builder, the PR
author, which protection allows and the snake does too. The foundation PR itself Tim
merges by hand after his review; the loop starts on master after that. CI on master builds the scenario report, the presenter page of the fixture deck, and a
Linux AppImage of the editor (electron-builder on the Ubuntu runner, a few minutes; the
Windows and macOS targets stay out of CI) and keeps them as artifacts; the presenter page
is also published where a browser can open it. Both links sit at the top of the night's
checklist: the presenter page is what the backlog changes night to night, the AppImage
is there for editor changes.

**Screenshots** are hosted where both GitHub and Notion can show them, and never on a
branch of the repo (Tim, 2026-10-21): an R2 bucket on Tim's Cloudflare account
(`PIPELINE_EVIDENCE_BUCKET`), written by `bin/evidence put <file>` with the S3 API and a
per-run token, returning the public URL that the PR comment and the Notion entry both
embed. The alternative, assets on a rolling GitHub release, needs no bucket but a persona
with contents write. The CI artifact zip stays as the full report.

After each merge, QA adds an entry to the night's **Notion test checklist**: one line per
merged issue, written for a person ("Open the presenter, press Next twice; the notes
should follow"), a checkbox, the issue link, the screenshot when there is one. The build
link sits at the top. One page per run, created when the loop starts, under a parent page
Tim names (`PIPELINE_NOTION_PARENT`); the writer is a small script (`bin/digest`) that
talks to the Notion API with an integration token, so a stage inside a container can call
it and the host can call it too. The audit trail stays on GitHub; Notion only points at it.

### Harnesses: the loop runs any agent, and can switch per stage

The loop never calls an agent CLI directly. A stage runs through a harness adapter,
`pipeline/harness/<name>` (`claude`, `codex`, `opencode`, and whatever comes next), one
small script each with the same contract: in, the prompt file, the model, the allow list
and the checkout path; out, an exit status, one usage line (tokens, cost when known) and
the log stream. The harness is chosen per stage and per run (`PIPELINE_HARNESS`,
`PIPELINE_HARNESS_PLAN` and so on), so Tim can switch mid-backlog or run one stage on a
different agent to compare. The container image carries every supported harness.

Constraint that follows: nothing that matters may depend on a Claude Code hook, because
the other harnesses have none. The repo lock and the edit hook stay as the fast path when
the harness is Claude; the container is the isolation and CI with the `bin/` scripts is
the check, and both are harness-neutral. The allow list is translated by each adapter
into that harness's own permission setting; a harness that cannot express it runs with the
container as its only boundary, which the adapter says in its log.

### A session can ask the loop for things

Each stage gets an outbox directory mounted from the host (`var/pipeline/out-<#>/`). A
session that wants something it cannot or should not do itself writes a request file
there, plain JSON, one per request, and the loop acts on them when the session ends:

- `{"spawn": {"persona": "advocate", "prompt": "...", "issue": 25, "harness": "claude"}}`:
  start a session as that persona with that prompt (Tim's example: a builder hands the
  advocate a prompt to file an issue). `issue` and `harness` are optional.
- `{"label": {"issue": 25, "add": ["triage"], "remove": ["stage:todo"]}}`.
- `{"note": "..."}`: a line for the loop's log and the morning digest.

Requests are harness-neutral by construction (any agent can write a file) and are the
one way personas hand work to each other without the loop knowing why. A spawned session
gets its own outbox, so chains are possible; the per-run ceilings bound them.

### The loop itself

`bin/pipeline`, ported from the snake, on the host, written so the pass logic
(`pipeline/pass.sh` or similar) is a function the watch loop, `--once`, and a future cloud
routine all call:

- `bin/pipeline` watches; `--once` one pass; `<#>` one issue in the foreground;
  `--status`; `--digest` writes the Notion page from what merged since the run started.
- A pass: reap dead sessions; refresh the mirror; sync the board; for each open issue, if a
  stage is due and a slot is free, start its container; unblock `stage:blocked` issues
  whose blockers closed; wake parked issues whose newest comment is human.
- Idle back-off: 30 s while anything moved in the last pass, doubling to 10 min when
  nothing is due (the lesson from the talk).
- Stop: Ctrl-C; running containers finish on their own and `finish` judges them when the
  loop next runs.

`pipeline/allow.txt` is the snake's list with the project's commands: `npm *`, `npx *`,
`bin/check*`, `node bin/*`, `xvfb-run *`, `gh-as *`, `git *`, and the read-only shell
tools. No `docker *` inside the container.

`bin/board`, ported: the board "Sozi pipeline" with columns Todo, Blocked, In progress,
Review, QA, Done, Parked, Triage, Ideas; `sync` each pass.

### Prompts

`pipeline/plan.md`, `build.md`, `review.md`, `qa.md`, ported from the snake and rewritten
for this repo: the standard's section numbers where a rule applies, the obviousness test,
the decide-and-record rule, the `# covers:` and tagging conventions, the checks to run
(`bin/check`, `npm test`, `npm run test:features`, `check:pr`, `check:deps`,
`check:coverage`), the PR template sections, and QA's checklist entry. Each prompt reads
`CLAUDE.md` first; the policy lines live there.

## Cloud path (designed for, built later)

The container is the cloud shape: a stage is a checkout, a token, a prompt. To run a stage
as a Claude Code cloud session instead of a container, the following must hold, and the
builder keeps each true from the first version:

1. The gh-personas plugin loads from the repo's `.claude/settings.json`
   (`extraKnownMarketplaces` plus `enabledPlugins`), not from the host's plugin cache.
   (To verify in the first version: whether headless `claude -p` installs them unprompted;
   if not, the container image installs them and the cloud path needs the same step.)
2. GitHub tokens come from the minting worker (`GH_MINT_URL`/`GH_MINT_KEY`), the path the
   cloud sessions already use.
3. No stage reads a display, a local MCP or a file outside the checkout; the only host
   state a stage touches is GitHub.
4. The host loop is replaceable by a scheduled cloud routine that runs one pass, or by a
   per-ticket trigger that starts one session per due stage; the pass logic lives in a
   script the routine can call, not in the watch loop.

What changes for it, when the time comes: a cloud routine on a schedule (the account can
create those) that runs `bin/pipeline --once` with the pass logic choosing "start a cloud
session" instead of "start a container"; the Notion token and the mint key as session
secrets; the board sync running from the same routine.

### Builder notes from the design review

- The container's checkout must have the GitHub URL as `origin`: `gh-as` and the repo lock
  resolve the repository from it, and a file-path origin to the mirror breaks both. Clone
  from the mirror with `--reference`, then set `origin` to GitHub.
- The epic (#24) never carries a stage label; only its children move.
- A parked issue resumes at the stage it parked from, not always `stage:in-progress`.
- One loop instance per repo (Sozi, then sozi-channel): the repo lock denies cross-repo
  access, so each repo has its own image, board and Notion page per run.
- Day-one checks the builder verifies and writes back here: whether headless `claude -p`
  installs the marketplaces named in `.claude/settings.json`; whether the Mobbin MCP is
  reachable inside the container.

## What is left to the builder

- The exact Dockerfile and the mirror-volume mechanics; whether `npm ci` is cached in the
  image or run per stage.
- The Notion page layout and the `bin/digest` script's API calls.
- The local mint endpoint (a few dozen lines; it answers the worker's request shape).
- Where the presenter page is published (the same R2 bucket, or GitHub Pages).
- The harness adapters beyond `claude`; the first version ships `claude` working and the
  adapter contract documented, with `codex` and `opencode` stubs that fail clearly.
- The request vocabulary's exact schema and validation.
- The wording of the four prompts, within the rules above.
- The board column names beyond the stage mapping.
- Verification of the plugin-loading question in "Cloud path" item 1, and its answer
  written into this document.

## Calls made in this document, not said by Tim

- The `advocate` persona is not a loop stage; the architect's triage covers thin issues.
- `stage:blocked` and the `triage` label are new; the snake had neither.
- The obviousness test's wording.
- Two parallel stages by default.
- The mint-worker token path as the default inside containers.
- One Notion page per run, created at start, written by a script rather than an MCP.
- The local mint endpoint as the way host-minted tokens reach containers.
- A wall-clock cap per session, since this CLI version has no turn limit flag.
- A Linux AppImage per merge and no other platform in CI.
- R2 as the evidence host (Tim ruled out a branch; the release-asset alternative is noted).
- The harness adapter contract and the three request kinds.
