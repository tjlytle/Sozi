# Sozi CLI Progress

## Status: Phase 1 - Not Started

## Quick Reference
- Research: `docs/sozi-cli/RESEARCH.md`
- Implementation: `docs/sozi-cli/IMPLEMENTATION.md`
- Anchor issue: #1. Phase issues: #2 (585), #3 (355), #4 (313), #5 (519).

---

## Phase Progress

### Phase 1: CLI foundation (inspect, build) — branch `1-cli-foundation`
**Status:** Not Started
#### Tasks Completed
- (none yet)
#### Decisions Made
- (none yet)
#### Blockers
- xvfb not yet installed (Tim to run `sudo apt install -y xvfb`).

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

### 2026-10-05
- Research complete, posted to #1. Decisions: foundation PR then one PR per issue,
  stacked branches, xvfb for tests, Opus subagents.
- Spike: hidden Electron window gives correct getBBox/CTM and a painted capturePage on
  a display; no display segfaults.

## Files Changed
(none yet)

## Architectural Decisions
- CLI lives inside the Sozi binary as `--cli`, hidden window, full editor page.
- Exit only via `app.exit(code)` after stdout flush; stdout is JSON only, logs to stderr.

## Lessons Learned
- `gh` in a fork clone defaults to the parent repo; always `-R tjlytle/Sozi`.
