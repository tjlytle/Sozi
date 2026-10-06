# Sozi CLI Progress

## Status: Phases 1-3 complete (PRs #6, #7, #8 ready for review). Phase 4 - Not Started

## Quick Reference
- Research: `docs/sozi-cli/RESEARCH.md`
- Implementation: `docs/sozi-cli/IMPLEMENTATION.md`
- Anchor issue: #1. Phase issues: #2 (585), #3 (355), #4 (313), #5 (519).

---

## Phase Progress

### Phase 1: CLI foundation (inspect, build) — branch `1-cli-foundation`
**Status:** Completed (PR #6)
#### Tasks Completed
- Task 1 (d36d8ef): `--cli` entry in the main process, hidden window, `--size`, display check
  (exit 2), usage (exit 2), `sozi-cli:result`/`sozi-cli:log` IPC, `app.exit` from the stdout
  callback, `src/js/cli/args.js` parser, test harness (`npm test` under xvfb-run, 15 tests).
  Reviewed: approved, four minors carried into tasks 2 and 3.
- Task 2 (6afcf6d..f381ed2): renderer runner (`src/js/cli/index.js`), `build` command, awaited
  HTML writes in Storage, `writeOnOpen` flag, refusal to build from an unparsable JSON, failed
  saves reject. 25 tests. Reviewed: approved, five minors (three carried into task 3).
  Verified by hand on the BattleSnake deck under xvfb: 1.2 s, JSON untouched, both HTML files.
- Task 3 (02916b8..85f332a): `inspect` command, README "Command line" section, startup-crash
  reply seeded, extensionless-file usage error, watcher skipped in CLI mode. 37 tests.
  Reviewed: approved, five minors deferred to the whole-branch review.
  Verified by hand: inspect on the Hamburg deck reports the 16 unanchored layer-frames and the
  layer missing from the JSON that the research found; BattleSnake shows layer3 unanchored in
  all 32 frames.
#### Decisions Made
- The renderer gets the parsed args plus `cwd` through `additionalArguments`; its own
  `process.cwd()` is the install dir.
- Loading a deck in CLI mode must not write HTML/JSON on open (Storage flag, task 2).
- Debian's xvfb-run merges stderr into stdout; README must show `2>/dev/null` inside the
  wrapped command.
#### Blockers
- (none)

### Phase 2: Explicit title (#5) — branch `5-title`
**Status:** Completed (PR #7, stacked on #6)
#### Tasks Completed
- Task 1 (c2f4046): `explicitTitle`/`svgTitle` + `title` getter, storables, editor field, empty
  `<title/>` guard, window title via repaint, 6 tests incl. a headless-Chrome runtime check.
- Task 2 (5cad92e..ecf4663): `build --title`, table-driven `set`, `inspect` title fields, README,
  template escaping, script-safe embedded data (every `<` escaped; `<!--<script>` proven in
  Chrome), carried phase 1 validation fixes. 74 tests.
- Final review fix wave (0f4a833..554d186): string-only JSON title with warning, trimmed title,
  "Presentation title" label, upstream-write hook fails closed / case-insensitive / narrowed, 14
  hook tests. 90 tests.
#### Decisions Made
- `--title ""` or whitespace clears the key; non-string JSON titles are ignored with a warning.
- The guard hook (`.claude/hooks/no-upstream-writes.sh`) ships in this PR though unrelated to #5.

### Phase 3: Presentation name independent of the SVG (#3) — branch `3-presentation-name`
**Status:** Completed (PR #8, stacked on #7)
#### Tasks Completed
- Task 1 (358ffbb): `src/js/naming.js` (`presentationFiles`, `replaceFileExtWith`) shared by the
  editor and the CLI; three regex copies removed; default names byte-identical; an extensionless
  SVG is no longer overwritten by its presenter file. 98 tests.
- Task 2 (740d23a..71e2dcd): `svg` key (written only when non-default), open by `.sozi.json` in
  the CLI, editor argv and file chooser, `--presentation`, `svgSource`, README; hook denies
  `gh api` field writes. 122 tests.
- Final review fix wave (e29333d..2d28f01): only `.sozi.json` is a presentation and invalid data
  is refused with no fallback (a foreign `chart.json` beside `chart.svg` was being overwritten);
  absolute `svg` keys no longer churn the JSON; warning + README caveat for relative hrefs when
  the HTML is built away from the SVG (until phase 4); key-change warning; chooser title and
  reopen; hook matches attached short-flag values. 133 tests.
#### Decisions Made
- Presentation files must end in `.sozi.json`; any other `.json` is refused (the chooser filter
  stays `json` because Electron cannot filter on a double extension).
- JSON and HTML live beside the presentation file; images, media and custom files resolve
  against the SVG directory.
- Untrusted `svg` keys are followed anywhere on disk (same trust level as custom files);
  README note deferred.

### Phase 4: Output directory (#4) — branch `4-out-dir`
**Status:** Not Started

### Phase 5: Render and export (#2) — branch `2-render-export`
**Status:** Not Started

---

## Session Log

### 2026-10-06 (later still)
- Phase 3 done (2 tasks, final review + 6-commit fix wave). Hand-tested two presentations from
  the BattleSnake SVG, rebuild-by-JSON stability, and a refused foreign JSON. Phase 4 started.

### 2026-10-06 (later)
- Phase 2 done end to end (2 tasks, 1 pre-review fix, 1 fix round, final review + fix wave).
  Hand-tested `build --title` on the BattleSnake deck. Phase 3 started.

### 2026-10-06
- Task 1 implemented and reviewed (Opus implementer + Opus reviewer). Footer amended.
- Task 2 implemented, fixed pre-review (corrupt JSON, failed save), reviewed, pushed. Draft PR #6
  opened after task 1 at Tim's request; reviews posted there by the reviewer persona.
- Task 3 implemented, reviewed, pushed. Whole-branch review: "with fixes" (JSON rewritten by
  default and non-idempotent; unknown flags accepted; crash paths broke the stdout contract;
  3.4 MB fixture with rasters and a personal path on a public repo). One fix wave (5 commits,
  53 tests), scoped re-review clean. PR #6 marked ready.
- Hand-tested on real decks under xvfb: build twice leaves the JSON byte-identical; `--no-jsn`
  and an extra argument exit 2; `--timeout 1` exits 1 with JSON; the 95 MB DailerAPI deck
  builds in 3.5 s; inspect on the Hamburg deck reproduces the research's position-loss data.

### 2026-10-05
- Research complete, posted to #1. Decisions: foundation PR then one PR per issue,
  stacked branches, xvfb for tests, Opus subagents.
- Spike: hidden Electron window gives correct getBBox/CTM and a painted capturePage on
  a display; no display segfaults.

## Files Changed
- `src/js/index-electron.js`, `src/js/editor.js`, `src/js/cli/args.js`, `src/js/cli/index.js`,
  `test/cli/*`, `test/fixtures/*`, `package.json`, `src/js/Storage.js`, `src/js/backend/Electron.js`,
  `src/js/cli/commands/build.js`, `src/js/cli/commands/inspect.js`, `README.md`

## Rulings made while Tim was away (phase 1)
- `build` never rewrites the JSON unless it is missing, something changed it, or `--write-json`
  is given; `--no-json` was removed. If wrong: one flag to change in any script.
- The BattleSnake fixture was slimmed (rasters and the `../../Haven/...` link stripped, reference
  HTML deleted, data comparison instead of a size check) without waiting, because the repo is
  public. The full fixture remains in PR #6's pushed history; rewrite the branch before merging
  if that matters.
- Camera values drift by ~1e-6 on every load (upstream behaviour); recorded, not fixed.
- English is forced for CLI messages, in memory only.
- Two re-review minors parked into phase 2: non-string `--timeout`/`--size` values; prototype
  names pass flag validation.

## Rulings made while Tim was away (phase 2)
- The `</script>` concern was fixed before review rather than deferred, then widened to every `<`
  after the reviewer proved `<!--<script>` in Chrome. HTML bytes change for decks with `<` in
  notes; values are identical after parsing.
- Two phase 1 re-review minors (valueless `--timeout`/`--size`, prototype flag names) were fixed
  here instead of a second phase 1 fix wave.
- The upstream-write guard hook was committed on this branch so it lands with the next merge.
- Hook gap carried to phase 3: `gh api ... -f` implicit POST is not matched.

## Rulings made while Tim was away (phase 3)
- The naming helper lives in `src/js/naming.js` (pure module) rather than "on Storage" so it can
  be unit-tested without Electron.
- Narrowed presentation files to `.sozi.json` after the reviewer found the data-loss path; the
  plan already said so, the implementation had widened it.
- Filed the pre-existing editor behaviour (a corrupt default `deck.sozi.json` is recreated on
  open) as a separate fork issue rather than fixing it in this phase.

## Architectural Decisions
- CLI lives inside the Sozi binary as `--cli`, hidden window, full editor page.
- Exit only via `app.exit(code)` after stdout flush; stdout is JSON only, logs to stderr.

## Lessons Learned
- `gh` in a fork clone defaults to the parent repo; always `-R tjlytle/Sozi`.
