# Sozi CLI Progress

## Status: Phase 1 - Complete, PR #6 ready for review. Phase 2 - Not Started

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
**Status:** Not Started

### Phase 3: Presentation name independent of the SVG (#3) — branch `3-presentation-name`
**Status:** Not Started

### Phase 4: Output directory (#4) — branch `4-out-dir`
**Status:** Not Started

### Phase 5: Render and export (#2) — branch `2-render-export`
**Status:** Not Started

---

## Session Log

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

## Architectural Decisions
- CLI lives inside the Sozi binary as `--cli`, hidden window, full editor page.
- Exit only via `app.exit(code)` after stdout flush; stdout is JSON only, logs to stderr.

## Lessons Learned
- `gh` in a fork clone defaults to the parent repo; always `-R tjlytle/Sozi`.
