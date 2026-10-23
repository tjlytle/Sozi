# The factory loop: design

Status: design agreed with Tim on 2026-10-21, after two rounds of notes; this document is
what a builder plans from. The code standard (`code-standard.md`) says how the code looks and
what CI checks; this says how issues move through the personas unattended.

## Intent

Tim files work as GitHub issues, either from a planning session (an epic and its children,
already carrying acceptance criteria and often a plan) or by typing a few lines into a new
issue. He starts the loop with a stop condition (a span of time, an epic, or the whole
backlog) and, the next time he looks, finds:

- a build he can click through, made from exactly what merged since he last looked;
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
| `stage:todo` | architect | `pipeline/plan.md`: triage and plan | `stage:tests`, or `stage:blocked`, or `triage` |
| `stage:blocked` | nobody | waits for the issues its plan names | `stage:tests` when they are closed (the loop checks each pass) |
| `stage:tests` | qa | `pipeline/tests.md`: the feature file from the plan's Scenarios, red, pushed (standard 6.6) | `stage:in-progress` |
| `stage:in-progress` | builder | `pipeline/build.md`: makes the scenarios green, unit tests first | `stage:review` |
| `stage:review` | reviewer | `pipeline/review.md` | `stage:qa`, or back to `stage:in-progress` |
| `stage:qa` | qa | `pipeline/qa.md`: scenarios, evidence, merge | `stage:done` (closed by the merge), or back to `stage:in-progress` |
| `stage:done` | | merged | |
| `stage:parked` | | mechanical blocker only (a missing credential, a push the lock denied); `@tjlytle` in one comment | `stage:in-progress` when the newest comment is from a human |
| `triage` | | needs Tim: a non-obvious finding, a user-facing question with no clear better way, an issue too thin to plan | Tim adds `stage:todo` or closes it |
| `idea` | | an alternative the architect chose against, for Tim to weigh | same |
| `working` | ops | a session holds the issue right now | |

There is no `stage:planned`: `Plans: auto` (interview decision), the architect moves a
planned issue straight to `stage:tests`. A return from review or QA goes to
`stage:in-progress`, not back through tests; the scenarios already exist.

**The board is a projection of the labels, not a copy** (Tim, 2026-10-21). The labels
are the loop's state machine and can be as fine as the loop needs; the board shows what
a person wants to know, so its mapping is many-to-one: `stage:tests` and
`stage:in-progress` are both the column "In progress". A dragged card is read the other
way with two rules: a card sitting in the column its label maps to is agreement, and a
card dragged into a column takes that column's entry stage (`stage:tests` for "In
progress").

### Run settings, read by the loop, told to the agents

The snake kept policy lines in `CLAUDE.md` because an agent was the orchestrator there
and read them. Here the orchestrator is a script, so the script owns the policy and no
agent is asked to find it (Tim, 2026-10-21: "who reads those?"). The loop's settings live
in one file, `pipeline/config` (sourced by `bin/pipeline`, each value overridable by
environment variable), and the three policies are settings among the others:

```
PIPELINE_MERGE=auto        # auto: QA merges; review: QA stops at approval and Tim merges
PIPELINE_PLANS=auto        # auto: a planned issue starts; review: it waits for Tim
PIPELINE_FINDINGS=obvious  # obvious: obvious findings start on their own; triage: all wait
PIPELINE_BACKLOG=172       # the epic every finding and idea is filed under
```

An alternative a session did not take is recorded where the session records its work
(the plan's Decisions taken, the PR body, the review) and becomes an `idea` issue only
when it would be worth doing on its own even after the issue is done the chosen way
(Tim, 2026-10-23: the first unattended run filed 32 ideas, 30 of them the routes the
architect did not take).

The loop writes a short "Run settings" block at the top of every stage prompt it starts
(the adapter prepends it to the prompt file), so each session is told the policy that
applies to it in plain words ("Merge when the gate is green; do not wait for a person").
Nothing in `CLAUDE.md` is a policy; it only points at the standard and the scripts.

### Stop conditions

The loop runs until the condition Tim gave it is met, then stops on its own (Tim,
2026-10-21: a span of time, an epic and the issues it spawns, or everything). In words
"the next time he looks" means after the loop stopped or while it is still running; it
never means a fixed hour.

- `--until <duration|time>` (`--until 6h`, `--until 07:00`): no new session starts after
  that point; running sessions finish and are judged.
- `--epic <#>`: the scope is the epic's open children. Issues the sessions file while
  they work go to the backlog epic (`PIPELINE_BACKLOG`), not into the epic: the first
  unattended run (#93) grew from 15 issues to 65 because every finding and idea copied
  the epic's `Part of` line, so the run never emptied (Tim, 2026-10-23, replacing "an
  epic and the issues it spawns" of 2026-10-21). Tim triages the backlog and moves an
  issue into an epic. The loop stops when nothing in the scope is due: each issue is
  done, or is parked, in triage, an idea, or blocked by an issue outside the scope.
- No flag: the scope is every open issue with a stage label, and the loop stops when
  nothing is due by the same test.

When it stops, the loop prints and logs why, writes the digest (the Notion checklist and
the summary line), and leaves `triage`, `idea` and `stage:parked` issues as the list of
what needs Tim. The conditions combine: `--epic 24 --until 6h` stops at whichever comes
first.

### Questions do not stop the line

By the time the plan is written, the questions are answered. The architect's plan states
each decision it took and why. Where a real fork exists, the architect picks the better
route and files the alternative as an `idea` issue ("Chosen against in #<n>: ...") so Tim
can weigh it when he next looks. A builder, reviewer or QA that meets a decision the plan does
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
directories; the one exception is the persona profile, described next. GitHub tokens: the host loop mints them (Tim, 2026-10-21: "the factory script
launching the container should mint the right token for that process and pass it in").
`gh-as` has exactly two ways to get a bot token, the local App keys or the mint worker
(`GH_MINT_URL`/`GH_MINT_KEY`), and the keys never enter a container. So the loop speaks
the worker's protocol itself: before each pass it mints one token per persona with
`bot-token` on the host and serves them from a small local endpoint (bound to the Docker
bridge, keyed by a per-run secret), and the container gets `GH_MINT_URL` pointing at it.
No change to the plugin, and the container uses the same path a cloud session uses
against the real worker. When Tim deploys the per-persona worker, the same containers
work unchanged with its URL instead.

**Persona profiles** (Tim, 2026-10-22). Each persona has a Docker volume,
`sozi-factory-profile-<persona>`, mounted at `/profile` in that persona's containers, with
`CLAUDE_CONFIG_DIR=/profile/claude`, `CODEX_HOME=/profile/codex` and
`XDG_CONFIG_HOME=/profile/xdg` set, so a profile holds every harness's configuration:
the login and the MCP servers authorised in it.
- `node bin/pipeline.js --login <persona> [--harness claude|codex|opencode]` opens an
  interactive container on that volume (`pipeline/login.sh` prints the steps: `claude`,
  `/login`, exit; then per allowed server `claude mcp add --scope user <name> ...`, and
  `claude`, `/mcp` to authorise it, exit). A fresh profile has no servers and `/mcp` only
  authorises configured ones; user scope, because the default local scope files a server
  under the login container's working directory, which no stage shares. It runs on the host network only during the login, so an MCP
  OAuth callback to a localhost port reaches it.
- Tim's decision: six profiles. Log in once (`/login`, no `/mcp`), `--copy-profile
  <from> <to>` to the other five, then `--login` again per persona with an allowlist to
  `claude mcp add --scope user` and `/mcp` exactly its servers (a copy carries all of its
  source's). If a token refresh
  invalidates the copies, fix it then.
- `PIPELINE_PROFILES=auto|off`. With a profile, the stage uses it. With no volume but a
  `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, the token is the fallback. With
  neither, the stage is refused with the `--login <persona>` command; a volume that is
  not logged in is refused as "profile of <persona> is not logged in", without it.
- `PIPELINE_MCP_<PERSONA>` (in `pipeline/config`) is the allowlist: architect
  `mobbin,context7`, advocate `mobbin`, builder `context7`. A profile holding a server
  outside its list is refused, naming the servers. `profile-inspect.sh` reports names and
  booleans only, the servers merged from the top-level `mcpServers` of `.claude.json` and
  every `projects.<path>.mcpServers` (local scope), so the allowlist sees both; `--status` prints one line per profile.
- `PIPELINE_PER_PERSONA` (default 1) allows one session per persona at a time, since a
  profile is one account's login; an issue that has to wait logs
  `waits, <persona> at its limit`.
- Hosted cloud sessions (Claude Code cloud, Codex cloud) cannot mount a volume: a
  follow-on (candidate: the profile as an encrypted blob restored at container start).
- Claude's auto memory stays on in the profiles (Tim, 2026-10-23): a persona keeps the
  notes it writes across sessions, in its volume and outside the repo, and a copy
  carries them.

**Older check failures** (Tim, 2026-10-23). A file a stage touches may already fail the
checks on lines the stage did not write (old code stays red until its cleanup issue
lands). Those are not the builder's to fix: at best it files an issue for a failure no
issue covers, and the PR body maps each one to its issue. The reviewer treats only
failures on changed lines as defects. The outside hook pass is meant to report only
changed lines too (#91).

**Ceilings** (Tim: limits per agent and per machine, and the loop throttles near a usage
limit). A fixed number of containers at a time (`PIPELINE_PARALLEL`, default two; a build
or QA stage runs an Electron build and Chromium, so the default is sized for a laptop).
Each session has a wall-clock cap (`PIPELINE_SESSION_MINUTES`, default 45; the container
is stopped and the run counts as a failed try) and, on an API key, `--max-budget-usd` per
session. The loop reads every session's result line (tokens and cost from the stream)
and keeps a running total per run: past a soft limit it drops to one container, past a
hard limit it starts nothing more and stops as if the stop condition were met, and a rate-limit result backs the
loop off for fifteen minutes. The limits are per-run settings (`PIPELINE_SOFT_TOKENS`,
`PIPELINE_HARD_TOKENS`, or USD on an API key); a subscription's own usage window cannot
be queried, so the totals are the loop's own count. Self-started issues are not capped
separately: the container count and the limits bound them.

### Merge and the next look

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
is also published where a browser can open it. Both links sit at the top of the run's
checklist: the presenter page is what the backlog changes run to run, the AppImage
is there for editor changes.

**Screenshots** are hosted where both GitHub and Notion can show them, and never on a
branch of the repo (Tim, 2026-10-21): an R2 bucket on Tim's Cloudflare account
(`PIPELINE_EVIDENCE_BUCKET`), written by `bin/evidence put <file>` with the S3 API and a
per-run token, returning the public URL that the PR comment and the Notion entry both
embed. The alternative, assets on a rolling GitHub release, needs no bucket but a persona
with contents write. The CI artifact zip stays as the full report.

After each merge, QA adds an entry to the run's **Notion test checklist**: one line per
merged issue, written for a person ("Open the presenter, press Next twice; the notes
should follow"), a checkbox, the issue link, the screenshot when there is one. The build
link sits at the top. One page per run, created when the loop starts, under a parent page
Tim names (`PIPELINE_NOTION_PARENT`: the page URL, its `Title-<id>` slug, the bare 32-hex
id or the dashed UUID all work); the writer is a small script (`bin/digest`) that
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
the check, and both are harness-neutral. Each adapter also brings the equivalent of
the two Claude Code hooks (the repo lock and the edit hook) in whatever form its harness
has: a real hook where the harness offers one, otherwise a skill or standing instruction
that tells the agent to run `bin/check` and `check-file.py --advise` on every file it
writes. A harness with real hooks will do better, since an instruction can be skipped
and a hook cannot; CI holds the line either way. The allow list is translated by each adapter
into that harness's own permission setting; a harness that cannot express it runs with the
container as its only boundary, which the adapter says in its log.

**Hooks from the outside.** The loop also runs the edit hook's checks itself, for every
harness, so a harness without hooks still gets them (Tim, 2026-10-21: "implement hooks on
the outside"). When a session exits, before the loop judges it, the loop lists the files
the session changed in the checkout (tracked and untracked, against the commit the stage
started from) and runs on them exactly what the Claude hook runs: `bin/check <file>` and
`check-file.py --advise <file>`. A failing check, or an advisory note, is handed back to
the same session as its next message, prefixed "The edit hook would have told you:", and
the session continues from where it stopped. The adapter contract therefore has a
`resume` entry: `claude` resumes by session id, and the `codex` and `opencode` adapters
use their own continue mechanism; a harness that cannot resume starts a fresh session
with the prior log's tail and the failure, which is worse but works. At most three
resumes per stage, inside the same wall-clock cap. With Claude as the harness the inside
hook has usually already done this and the outside pass finds nothing; it costs one
check run. The same outside pass is where the loop learns what the session did (the
changed files, the commits, the PR it opened), independent of what the session says.

### A session can ask the loop for things

Each stage gets an outbox directory mounted from the host (`var/pipeline/out-<#>/`). A
session that wants something it cannot or should not do itself writes a request file
there, plain JSON, one per request, and the loop acts on them when the session ends:

- `{"spawn": {"persona": "advocate", "prompt": "...", "issue": 25, "harness": "claude"}}`:
  start a session as that persona with that prompt (Tim's example: a builder hands the
  advocate a prompt to file an issue). `issue` and `harness` are optional.
- `{"label": {"issue": 25, "add": ["triage"], "remove": ["stage:todo"]}}`.
- `{"done": {"issue": 25, "to": "stage:review"}}`: the stage is finished and the issue
  moves there. Every stage prompt ends with this request; it is how the loop learns the
  outcome without asking GitHub (next section).
- `{"note": "..."}`: a line for the loop's log and the run's digest.
- `{"wait": "..."}`: the session stops for a person (`Plans: review`, `Merge: review`);
  the issue waits at its stage, costs no try, and starts again when its stage changes.
  It is the only way to wait: a session that ends with neither a move nor a wait is a try.

A `done` request must name a move the stage the session ran may make (the "Moves to"
column above; any stage may also go to `stage:parked` or `triage`); any other is refused
and the session counts as a try.

Requests are harness-neutral by construction (any agent can write a file) and are the
one way personas hand work to each other without the loop knowing why. A spawned session
gets its own outbox, so chains are possible; the per-run ceilings bound them.

### The loop keeps its own state and asks GitHub little

Last time, the board and label polling hit the GraphQL rate limit (Tim, 2026-10-21). So
the loop's schedule runs from its own state file, `var/pipeline/state.json` (per issue:
stage, tries, the session holding it, its blockers, the board item id, when it was last
seen), and GitHub labels are the mirror people and other tools read, not what the loop
polls to decide its next move.

- A session ends by writing the `done` request; the loop applies that label change with
  one REST call, updates its state, and schedules the next stage from the state. A
  session that ends with no `done` request gets one label read (one REST call) to see
  whether it moved the issue by hand; no move is a failed try, as in the snake.
- The loop reads GitHub on a timer, `PIPELINE_SYNC_MINUTES` (default 10), and at start: one
  search for open issues with a stage, `triage`, `idea` or `working` label (new issues,
  labels Tim changed by hand, closed blockers), and one for parked issues with a newer
  comment than the loop last saw. That is two REST calls per sync, not two per issue.
- The board sync (GraphQL, the budget that ran out) runs at most once per sync and only
  for issues whose stage changed since the last sync, using the item ids in the state
  file; the full "fetch every item" sync runs only on start and on `bin/board sync --all`.
- A rate-limit reply (403 or 429 with the limit header) backs the sync off until the
  reset time GitHub names; sessions already running are not affected, and `done` requests
  queue in the state file until the next successful sync.

### The loop itself

`bin/pipeline`, ported from the snake, on the host, written so the pass logic
(`pipeline/pass.sh` or similar) is a function the watch loop, `--once`, and a future cloud
routine all call:

- `bin/pipeline` watches; `--once` one pass; `<#>` one issue in the foreground;
  `--status`; `--digest` writes the Notion page from what merged since the run started.
- A pass: reap finished sessions (run the outside hooks, read the outbox, apply `done`);
  refresh the mirror; sync with GitHub if the sync timer is due; for each issue in the
  state, if a stage is due and a slot is free, start its container; unblock
  `stage:blocked` issues whose blockers closed; wake parked issues whose newest comment is
  human; test the stop condition.
- Idle back-off: 30 s while anything moved in the last pass, doubling to 10 min when
  nothing is due (the lesson from the talk).
- Stop: Ctrl-C; running containers finish on their own and `finish` judges them when the
  loop next runs.

`pipeline/allow.txt` is the snake's list with the project's commands: `npm *`, `npx *`,
`bin/check*`, `node bin/*`, `gh-as *`, `git *`, and the read-only shell
tools. No `docker *` inside the container.

`bin/board`, ported: the board "Sozi pipeline" with columns Triage, Ideas, Todo, Blocked,
In progress (tests and build), Review, QA, Done, Parked; `sync` for the issues whose stage
changed since the last sync.

### Prompts

`pipeline/plan.md`, `tests.md`, `build.md`, `review.md`, `qa.md`, ported from the snake and rewritten
for this repo: the obviousness test, the decide-and-record rule, the `# covers:` and
tagging conventions, the checks to run (`bin/check`, `npm test`, `npm run test:features`,
`check:pr`, `check:deps`, `check:coverage`), the PR template sections, QA's checklist
entry, and the closing `done` request. Each prompt starts with the run settings block the
loop prepends and loads the code standard skill (next section); it never cites
`code-standard.md`.

### The standard agents read is a skill, not the record

`docs/software-factory/code-standard.md` is the record of how each rule was chosen: every
section carries the alternatives and the reasoning, and that is what makes it the wrong
thing to hand a model (Tim, 2026-10-21: it "would confuse agents because it has
alternatives"). It stays as the process artifact and nothing a persona reads cites it.

The standard agents read is the skill `.claude/skills/code-standard/`, in the Agent Skills
shape: `SKILL.md` (frontmatter `name` and `description`, then a short body every session
loads) and `references/<section>.md` files an agent loads when it touches that part
(JavaScript, CSS, dependencies, change discipline, tests). One skill rather than several
(Tim asked, 2026-10-21): each skill costs its description in every session's context,
the rules cross-reference each other, and the reference files give the same split
without that cost. Declarative, present tense, one line per rule, no alternatives, no
reasoning. Rules a tool enforces are one line naming the tool ("Prettier formats;
`bin/check --fix` applies it"); the rules that are judgment calls (the size guidelines,
one concern per module, the summary comment rule, when a feature file changes first) are
the body of `SKILL.md`, since those are the lines a model needs in words. Every message
the hooks and `bin/` scripts print cites the skill by section, not `code-standard.md`.
`CLAUDE.md` points at the skill as the standard and at the record as its history.

Harness-neutral by the same means as the hooks: the files live in that one place; the
`claude` adapter loads it as a skill, Codex finds it through the `.agents/skills` link,
and the builder verifies per harness whether more is needed. The skill is written as part
of the foundation PR, from the record, so the loop starts with it.

### Files for agents, files for people

Agent-only artifacts live under `.agents/` (Tim's convention, 2026-10-21): `plans/` for
implementation plans, `skills` as a link to `.claude/skills` for harnesses that look
there, and `tmp/` (gitignored) as the one scratch directory every harness and every
stage prompt can name, since only Claude Code gives a session a scratchpad of its own.
`AGENTS.md` is a link to `CLAUDE.md`. `docs/` stays for documents people read too, which
is where this design and the code-standard record stay. The loop's own runtime files
(`var/pipeline/`) are the loop's, not an agent's, and stay where they are.

## Cloud path (designed for, built later)

The container is the cloud shape: a stage is a checkout, a token, a prompt. To run a stage
as a Claude Code cloud session instead of a container, the following must hold, and the
builder keeps each true from the first version:

1. The gh-personas plugin loads from the repo's `.claude/settings.json`
   (`extraKnownMarketplaces` plus `enabledPlugins`), not from the host's plugin cache.
   (To verify in the first version: whether headless `claude -p` installs them unprompted;
   if not, the container image installs them and the cloud path needs the same step.)
2. GitHub tokens come from the minting worker (`GH_MINT_URL`/`GH_MINT_KEY`), the path the
   cloud sessions already use. A minted token is an App installation token, so it reaches
   private repositories the App is installed on, with the App's own permissions; a cloud
   session that must read a second private repository needs the App installed there and
   the worker asked for a token naming both (the worker takes one `repo` today; a list is
   a small change in the worker, not in the loop).
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
- One loop, one project, and the project is one repository: see "One repository" below.
- The day-one checks are deferred to the launch plan's first supervised run
  (`.agents/plans/2026-10-21-factory-launch.md`, Task 6), because the Claude token was not
  available when the loop was built. Whoever runs it writes the answers back here: (1) does
  headless `claude -p` load the plugin hooks (a `gh-as` denial on a bare `git commit` in a
  second prompt) and install the marketplaces named in `.claude/settings.json`; (2) is the
  Mobbin MCP reachable inside the container without a display; (3) does `claude -p` in a
  fresh clone show a trust prompt, and if so what fixed it (a `.claude/settings.local.json`
  written by `stage.sh`, or `--permission-mode`). The image loads the plugin with
  `--plugin-dir /opt/gh-personas`, which sidesteps the marketplace question for the
  container; the cloud path still needs the answer.
- The Mobbin-in-container check (2) now means "Mobbin authorised in the architect and
  advocate profiles" (`--status` lists each profile's servers; the allowlists are in
  `pipeline/config`).
- What the build taught: the image is about 6.5 GB and builds in about 6 minutes. Stage
  runs on `master` run `npm ci` today, because master's lockfile differs from the branch
  until the foundation PR merges. `--once` and a Ctrl-C wait for running sessions, so the
  mint endpoint stays up while they work. A session that ends with a note and no done
  request is waiting for a person, not a failed try.

## One repository

Tim does not want one pipeline per repository (2026-10-21: "that just seems like noise"),
and the work ahead spans what are today two repositories (the fork and sozi-channel) and
may add more (an advanced presenter, interactive pieces, each a plugin). Two routes were
on the table: one repository with the extra pieces as directories, or a loop that spans a
list of repositories with the lock and the tokens widened to match.

Decision (confirmed by Tim, 2026-10-21): **one repository.** Everything that is
not upstream Sozi lives under `packages/<name>/` (the channel Worker, each plugin), with
its own `package.json` where it needs one, and the issues of sozi-channel #7 to #9 move
here. One pipeline, one board, one CI, one run per issue; a PR closes the issue it
belongs to, and branch protection and the reviewer apply the same way everywhere. The
cross-repository shape fails exactly where it matters: a PR cannot close an issue in
another repository, one issue cannot have one PR across two, and every tool from the
board to `Closes #n` assumes one. Licensing is not a concern: the whole repository is
open source and files under `packages/` carry MPL 2.0 like the rest (Tim, 2026-10-21:
what he would sell is the hosted convenience, not the code).

What stays open so a second repository could be added later without a redesign: the repo
lock takes a list of allowed repositories, the mint endpoint mints for each repository
in the list, and the loop has one `--repo` per project with the first entry as the home
of issues and PRs. Cross-repository issues stay out of scope.

## Future

- A judgment model that reads an issue and picks the harness and the model for each of
  its stages (build on X, review on Y), building on the per-stage harness setting the
  first version has. Nothing in the first version depends on it.
- A decision model in front of the merge, as the code standard's 6.4 anticipates.
- QA's scenarios written in parallel with the build through a spawn request from the
  architect, with disjoint file ownership on one branch (standard 6.6, alternative b),
  if the tests stage ever shows as the bottleneck.
- The cloud path above.

## What is left to the builder

- The exact Dockerfile and the mirror-volume mechanics; whether `npm ci` is cached in the
  image or run per stage.
- The Notion page layout and the `bin/digest` script's API calls.
- The local mint endpoint (a few dozen lines; it answers the worker's request shape).
- Where the presenter page is published (the same R2 bucket, or GitHub Pages).
- The harness adapters beyond `claude`; the first version ships `claude` working and the
  adapter contract documented, with `codex` and `opencode` stubs that fail clearly.
- The request vocabulary's exact schema and validation; the state file's exact shape.
- How each harness resumes a session, and what the fallback looks like for one that
  cannot.
- The `packages/` layout, settled when the first package moves in.
- The wording of the code standard skill, condensed from the record.
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
- The harness adapter contract and the four request kinds.
- The three stop conditions' flags and the "nothing is due" test; the default scope when
  no flag is given.
- Policy as loop settings in `pipeline/config`, prepended to prompts, instead of lines in
  `CLAUDE.md`.
- The outside hook pass and its three-resume limit.
- The local state file as the schedule's source of truth, the ten-minute sync, the
  per-change board sync.
- One repository with `packages/`, over a multi-repository loop.
- The skill as what agents read; the record as history; one skill with reference files
  rather than several skills.
- `.agents/` for plans, the skills link and scratch; `docs/` for people.
- The loop in Node rather than bash, so its state and pass logic are unit-tested.
- The tests stage as a sequential stage rather than a parallel session (Tim chose it
  from the two shapes offered); the board's many-to-one mapping and the entry-stage rule
  for dragged cards.
