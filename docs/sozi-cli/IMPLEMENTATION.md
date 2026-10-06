# Sozi CLI Implementation Plan

Anchor #1. Research: `docs/sozi-cli/RESEARCH.md`. Phases map one-to-one to stacked PRs
on tjlytle/Sozi (each branch starts from the previous; never against upstream).

## Overview

A `--cli` mode in the Sozi Electron binary: hidden window, full editor page, operations
through `Controller`/`Storage`, JSON on stdout, exit via `app.exit`. Tests run under
xvfb (`xvfb-run -a`). Each phase ends with a working command an agent can call.

## Prerequisites

- `npm install && npx gulp` builds; editor opens a deck (verified 2026-10-05).
- xvfb installed. Test decks copied from `~/Dropbox/Talks` into `test/fixtures/` only if
  small; otherwise reference a scratch copy. No licensed Library assets in the repo.
- Test runner: none exists upstream. Add `node:test` based tests in `test/cli/` that
  spawn the built binary; `npm test` runs `gulp` then the tests.

## Phase Summary

| Phase | Branch | PR closes | Delivers |
|---|---|---|---|
| 1 | `1-cli-foundation` | part of #2 | `--cli inspect`, `--cli build`; exit codes; tests |
| 2 | `5-title` | #5 | `title` in JSON, `--title`, editor field |
| 3 | `3-presentation-name` | #3 | `--presentation x.sozi.json`, `svg` key in JSON |
| 4 | `4-out-dir` | #4 | `--out-dir`, href rewriting |
| 5 | `2-render-export` | #2 | `--cli render`, exporter fixes, `--cli export` |

---

## Phase 1: CLI foundation (inspect, build)

### Objective
`sozi --cli build deck.svg` regenerates both HTML files with no visible window.
`sozi --cli inspect deck.svg` prints frames, layers, cameras, reference ids as JSON.

### Rationale
Everything else hangs off the hidden-window entry point and the "await the load"
plumbing. Build alone already removes the edit/convert/rebuild chore.

### Tasks
- [x] `index-electron.js`: parse argv before `ready`; `--cli` -> `show:false`, fixed size
      from `--size` (default 1280x720), `backgroundThrottling:false`, args via
      `additionalArguments`; `uncaughtException` and `render-process-gone` -> `app.exit(1)`;
      `ipcMain.handle("cli:exit")`; refuse to start without DISPLAY/WAYLAND_DISPLAY with a
      clear stderr message.
- [x] `backend/Electron.js`: CLI-aware argv (file is the first non-flag arg, not the
      last argv); in CLI mode skip file chooser, geometry restore, `beforeunload` dialog.
- [x] `Storage.js`: `openJSONFile` awaits the HTML and presenter writes; expose a
      `loaded` promise from `setSVGFile`.
- [x] New `src/js/cli/index.js`: command table, `controller.error/info` capture,
      in-memory prefs (`animateTransitions=false`, `saveMode=manual`, `reloadMode=manual`),
      never calls `preferences.save()` or `doAutosave()`; writes with `getJSONData()` and
      `exportHTML()`; stdout JSON `{ok, command, files, warnings, errors}`; exit codes
      0 ok, 1 command error, 2 usage.
- [x] `inspect`: presentation summary, frames (id, title, index), layers, per-frame
      per-layer camera state, reference/outline ids with `missing: true` when the id is
      not in the SVG.
- [x] `build`: writes `<name>.sozi.html` and `<name>-presenter.sozi.html`; `--no-json`
      to avoid rewriting the JSON; warns when the SVG is newer than the existing HTML.
- [x] Tests (`test/cli/*.test.js`, node:test, run via `xvfb-run -a`): build produces
      two files, JSON byte-identical when unchanged, inspect schema, usage error exit 2,
      missing file exit 1, no-display message.
- [x] README section "Command line".

### Success Criteria
Tests green under `npm test`. Running build on a copy of the BattleSnake deck yields
HTML equal to the editor's output apart from nothing (diff empty) and the JSON unchanged.

### Files Likely Affected
`src/js/index-electron.js`, `src/js/backend/Electron.js`, `src/js/Storage.js`,
`src/js/cli/*.js` (new), `gulpfile.js` (copy cli), `package.json` (test script),
`test/cli/*` (new), `README.md`.

---

## Phase 2: Explicit title (#5)

### Objective
`sozi --cli set --title "X" deck.svg` stores the title; build and player use it.

### Tasks
- [x] `Presentation.js`: `explicitTitle` field; `title` getter -> explicitTitle || svgTitle
      || "Untitled"; add to `toStorable`, `toMinimalStorable`, `fromStorable`; guard empty
      `<title/>`.
- [x] `view/Properties.js`: title field in the presentation section (one input).
- [x] CLI: `--title` on `build` and a `set` command; `inspect` reports `title` and
      `titleSource` (json | svg | default).
- [x] Tests: JSON round-trip, HTML `<title>`, player `document.title` after load
      (Playwright or Electron-driven check), old JSON without the key unchanged.

### Success Criteria
Built BattleSnake deck shows the given title in the tab and presenter; a deck without
the key still shows the SVG title.

### Files Likely Affected
`src/js/model/Presentation.js`, `src/js/view/Properties.js`, `src/js/cli/*`, `test/cli/*`,
`src/templates/player.html` (only if needed).

---

## Phase 3: Presentation name independent of the SVG (#3)

### Objective
`sozi --cli build --presentation talk-es.sozi.json present.svg` and opening
`talk-es.sozi.json` in the editor both resolve the SVG from the JSON.

### Tasks
- [x] `Storage.js`: `outputBaseName`; naming helper used at the three sites; JSON gains
      optional `svg` (path relative to the JSON). Opening a `.sozi.json` path (CLI or
      editor argv) reads `svg` and loads that SVG.
- [x] Editor: "Save presentation as..." is out of scope; only opening by JSON path.
- [x] CLI flag `--presentation`; `inspect` reports `svg` and `presentation` paths.
- [x] Tests: two JSONs on one SVG build two HTML pairs; default naming unchanged.

### Success Criteria
Two presentations built from one SVG; editor opens the JSON path and shows the deck.

### Files Likely Affected
`src/js/Storage.js`, `src/js/backend/Electron.js`, `src/js/cli/*`, `test/cli/*`.

---

## Phase 4: Output directory (#4)

### Objective
`--out-dir site/talk` writes both HTML files there with relative image and media hrefs
rewritten so they still resolve.

### Tasks
- [x] `Storage.js`: `outputLocation` at the HTML and presenter sites only; `exportHTML`
      rewrites relative `xlink:href`/`href` on `<image>` and `sozi:src` on media using
      `path.relative(outLoc, join(svgLoc, href))`; skip absolute, scheme and `#` hrefs.
- [x] Optional JSON key `outputDir` honoured by the editor's autosave.
- [x] CLI flag `--out-dir`; create the directory; `inspect` reports it.
- [x] Tests: deck with a relative image builds elsewhere and the href resolves (open in
      headless Chrome and check `naturalWidth > 0`).

### Success Criteria
Built deck in a different directory renders its linked images.

### Files Likely Affected
`src/js/Storage.js`, `src/js/model/Presentation.js`, `src/js/cli/*`, `test/cli/*`.

---

## Phase 5: Render and export (#2)

### Objective
`sozi --cli render --frame 7 deck.svg --out f7.png` and `sozi --cli export deck.svg`
(PDF, PPTX, video, PNG sequence) from the CLI; the GUI export works again from source.

### Tasks
- [x] Exporter: replace `ipcRenderer.sendTo` with `executeJavaScript`-driven stepping
      (fixes upstream #722); check ffmpeg exit status and capture stderr; zero-pad
      names; `-pix_fmt yuv420p` and even dimensions; background override; return after
      `onDone`; capture the first image even when `timeoutMs` is 0; empty selection error.
- [x] Move the exporter to a module usable from main or renderer (BrowserWindow, not
      remote); hidden or offscreen window with size check; CDP fallback for captures.
- [x] `render`: one frame (or `--all` to a directory) via the same window; `--size`.
- [x] `export`: honours JSON export settings with CLI overrides `--type --format --fps
      --width --height --bitrate --include --exclude --ffmpeg --out`.
- [x] Tests: render produces a PNG of the requested size with non-uniform pixels; PNG
      sequence count matches frames and timings; PDF page count; video only if ffmpeg
      present (skip otherwise).

### Success Criteria
Per-frame PNGs of the BattleSnake deck match what the editor preview shows; GUI export
completes from the source build.

### Files Likely Affected
`src/js/exporter/*`, `src/js/index-electron.js`, `src/js/cli/*`, `test/cli/*`, README.

---

## Post-Implementation
- [x] README updated (all commands, xvfb and display requirement); `doc/` site pages still to do.
- [ ] Skill `sozi-cli` in `~/Dropbox/Talks/.claude/skills` teaching the inspect/edit/
      render loop (separate repo, after phase 5).
- [ ] Evaluate upstream PR #759 for merge conflicts.

## Notes
- Stacked PRs: phase N branches from phase N-1; rebase as merges land.
- Every PR: `git checkout -- locales/messages.pot yarn.lock` before committing.
- Use `gh-as builder` for commits, pushes, PRs; `-R tjlytle/Sozi` always.
