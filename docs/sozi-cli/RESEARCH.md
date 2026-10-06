# Sozi CLI Research

Anchor: #1. Scope of this round: #2 (upstream 585), #3 (355), #4 (313), #5 (519).
Repo state: upstream master c8ef0cf, Electron 33.2.0, builds with `npx gulp` on Node 24.

## Overview

Add a command-line mode to the Sozi Electron binary that loads a presentation in a
hidden window, runs operations through the existing `Controller`/`Storage` code, writes
files, prints JSON to stdout and exits with a status code. Four upstream requests fall
out of it: headless export, presentation name independent of the SVG, output directory,
explicit title.

## Problem Statement

Sozi is GUI-only. Nothing can rebuild `*.sozi.html` after a script edits the frame file,
and nothing can render a frame for inspection. The naming rule (JSON/HTML derived from
the SVG name, written beside it) and the title rule (SVG `<title>` only) are baked into
two sites in `Storage.js` and one in `Presentation.js`.

## User Stories

- Agent edits `deck.sozi.json`, runs `sozi --cli build deck.svg`, gets fresh HTML.
- Agent runs `sozi --cli render --frame 7 deck.svg --out f7.png` and looks at it.
- Author keeps `present.svg` and builds `present-en.sozi.json` and `present-es.sozi.json` from it.
- Author builds into `site/talks/battlesnake/` with images still resolving.
- Author sets `--title "Hack the Snake"` and the tab stops saying "Untitled".

## Technical Research

### Facts from the source (file:line at c8ef0cf)

- Names: `replaceFileExtWith` (Storage.js:20); JSON at Storage.js:193-200; HTML and
  presenter at :275-280. One `location` variable serves JSON, HTML and presenter, and
  also `resolveRelativeURLs` (:198), `toRelativePath` (:411) and `readCustomFiles` (:421),
  which must stay on the SVG directory. Exporter names follow the HTML path
  (exporter/index-electron.js:243, 355, 403, 447).
- HTML keeps the SVG's relative image hrefs verbatim (`asText` serialized at
  SVGDocumentWrapper.js:230 before `resolveRelativeURLs`; embedded at Storage.js:384).
  Moving the HTML breaks relative images and `sozi:src` media. Custom CSS/JS are inlined
  (Storage.js:421-429) so they survive a move. Presenter loads the player by bare file
  name (presenter.html:86) so the pair must move together.
- Title: `Presentation.title` field, default "Untitled" (Presentation.js:659), set only
  from a direct `svg > title` child (:885-890); Inkscape RDF metadata is ignored; an empty
  `<title/>` throws. Not in `toStorable`/`toMinimalStorable`/`fromStorable`. The player
  rewrites `document.title` at runtime from `presentation.title` (player.js:191,
  Player.js:138), so the title must travel in the minimal JSON and the player bundle must
  be rebuilt.
- Startup: main process ignores argv (index-electron.js). The renderer backend takes the
  last argv element as the SVG path (backend/Electron.js:95-113), so flags after the
  file break it. Load chain `setSVGFile -> loadSVGData -> openJSONFile`; HTML writes are
  not awaited (:279-280, :293). No "loaded" promise is exposed.
- Controller: `perform` undo stack (Controller.js:1822); mutators act on `Selection`,
  so select first (`selectFrame` :807, `updateLayerSelection` :902). Pure-model:
  deleteFrames, moveFrames, set*Property. Need live cameras from `Preview.onLoad`:
  addFrame without selection, every select*, updateCameraStates, setOutlineElement,
  fitElement, autoselectOutlineElement. Conclusion: keep the whole editor page, hide the
  window.
- Errors: `controller.error/info` only render into the DOM (:223-267). CLI must override
  them. Preferences live in localStorage shared with the GUI; `doAutosave` persists
  them, so CLI must not call it.
- Export: runs in the editor renderer, opens a visible frameless window per export
  (exporter/index-electron.js:198-206), drives frames by renderer-to-renderer IPC.
  `exporter-preload.js:17,22,45,50` call `ipcRenderer.sendTo`, removed in Electron 28;
  Electron 33 `electron.d.ts` has no `sendTo`. Commit e6bff7d (2024-11-02) moved to
  Electron 33. So every export hangs in builds after that commit: upstream #722.
  ffmpeg exit status is never checked (:451-469), transparent/background handling is
  absent, sequence names are unpadded (:492, 522). Upstream #650/#604/#637/#716/#717.
- Export settings in JSON: `exportType`, `exportToPDF{PageSize,PageOrientation,Include,
  Exclude}`, `exportToPPTX{SlideSize,Include,Exclude}`, `exportToVideo{Format,Width,
  Height,FrameRate,BitRate}` (Presentation.js:759-848). Frame-list grammar at
  exporter/index-electron.js:35-79. Video ignores include/exclude.

### Spike results (2026-10-05, this machine)

- Hidden window (`show:false`, 1280x720, `backgroundThrottling:false`, `--disable-gpu`)
  loading the BattleSnake SVG: `getBBox`, `getScreenCTM`, `clientWidth` all correct and
  non-zero; `webContents.capturePage` returns a painted 1280x691 image.
- No display at all: Electron segfaults, also with `--ozone-platform=headless`. `xvfb`
  is installable (apt candidate 2:21.1.12) but not installed. The CLI needs a display or
  xvfb; document it, do not fight it.
- Editor built from source opens a real deck unchanged (frame-file checksum identical).

### Approach Options

1. Node-only script that edits JSON without Electron. Rejected: camera math needs
   `getBBox`; HTML needs DOMParser; drifts from editor behaviour.
2. Playwright over the generated HTML. Rejected for editing: no access to editor model;
   fine for rendering but duplicates what a hidden Electron window gives for free.
3. CLI mode inside the Sozi binary, hidden window, full editor page, operations through
   `Controller`. Chosen. Shares every code path with the GUI; fixes #722 on the way.

### Recommended Approach

- `index-electron.js`: detect `--cli`; create the window `show:false`, fixed size,
  `backgroundThrottling:false`; pass the args via `additionalArguments`; exit code via
  `ipcMain` + `app.exit`.
- `backend/Electron.js`: CLI-aware argv; skip file chooser, geometry restore and the
  `beforeunload` dialog; `await setSVGFile`; hand off to a new `cli/` module.
- `cli/` module: command table `inspect | check | build | render | set-title | ...`;
  overrides `controller.error/info`; in-memory prefs `animateTransitions=false`,
  `saveMode=manual`, `reloadMode=manual`; writes files directly with `getJSONData()` and
  `exportHTML()`; never touches localStorage.
- `Storage.js`: `outputLocation` and `outputBaseName` (default null) used at the three
  naming sites; `location` stays the SVG dir for resolution. For a moved HTML, rewrite
  relative hrefs in `exportHTML` as `path.relative(outLoc, join(svgLoc, href))`.
- `Presentation.js`: `explicitTitle` field, `title` getter falls back to the SVG title
  then "Untitled"; add to the three storable methods; guard empty `<title/>`.
- Exporter: replace `sendTo` IPC with `executeJavaScript` driving; check ffmpeg status;
  pad names; `-pix_fmt yuv420p`; background override. Render command uses the same
  hidden window and `capturePage`.

### Required Technologies

Electron 33 (hidden BrowserWindow, `capturePage`, `ipcMain`), nunjucks (template),
ffmpeg on PATH or `--ffmpeg`, xvfb on display-less hosts. No new npm dependencies
expected except possibly a tiny arg parser.

## Data Requirements

New optional JSON keys: `title` (string), `svg` (relative path from the JSON to its SVG,
for #3), `outputDir` (relative, for #4). All optional; absent means today's behaviour.
No format version field exists; keep it that way and rely on `copyIfSet`.

## Integration Points

Storage naming sites; Presentation storables; Electron backend argv; exporter; the
nunjucks template is compiled twice (gulp then runtime), so template edits need `gulp`.
`gulp` rewrites `locales/messages.pot` and `yarn.lock`; revert before committing.

## Risks and Challenges

- Window size affects `fitElement` results through `viewport.scale`; fix the CLI window
  to the presentation aspect at a known size and test for scale invariance.
- Running the CLI while the GUI has the same deck open: GUI ignores JSON changes and
  overwrites on blur. Document "editor closed", later add a lock or live mode.
- localStorage/LevelDB profile shared with the GUI; use `app.setPath("userData")` to a
  CLI-specific dir if conflicts appear.
- #3 changes a load-bearing assumption (JSON looked up by SVG name). Keep the default
  path identical and only add the explicit path route.
- Upstream PR #759 (performance) touches Controller.js and Presentation.js; our changes
  there should stay small to ease a later merge.

## Open Questions

- Does `--cli` ship as a flag on the Sozi binary (chosen for now) or a separate entry
  script? Flag keeps one build.
- Should #4 copy linked images into the output dir or rewrite hrefs? Rewrite first.
- Install xvfb on this machine for display-less tests, or always test under the desktop
  display? xvfb is an apt install; decision for Tim.

## Web findings (agent, 2026-10-05; URLs in References)

- Electron 33: `paintWhenInitiallyHidden` defaults true, so a `show:false` window still
  lays out and paints; page visibility reports `visible`; keep `backgroundThrottling:false`.
  `capturePage` from hidden windows has open bug reports (electron#36376 hang, #32001 no
  paint events, #45398 slow animations on Linux); our spike worked here, so keep
  `capturePage` but verify output size on every run and fall back to CDP
  `Page.captureScreenshot` (what Sozi's exporter uses) if captures come back empty.
  Offscreen mode (`offscreen:true`) is what drawio-desktop moved to in 28.2.7 to escape
  screen-size clamping; it has no deviceScaleFactor option in 33.
- `process.exitCode` is ignored by Electron 33's main process (electron#27893, fixed
  only in 2026). Exit through `app.exit(code)` from the stdout write callback, because
  POSIX pipe writes are asynchronous and can be lost.
- `--headless` is officially unsupported for Electron; xvfb is the documented route
  (testing-on-headless-ci). drawio's CI line: `xvfb-run --auto-servernum app --no-sandbox
  --disable-gpu`. Fail early with a clear message when no display is present.
- drawio-desktop `--export` is the model: branch before the single-instance lock, global
  `uncaughtException` -> `app.exit(1)`, `render-process-gone` handler, per-file timeout,
  a dedicated light renderer page, never exit 0 without checking the output file exists
  (drawio#2230), filter Electron's own switches out of argv (drawio#1056).
- Video: deterministic stepping plus one capture per step, then ffmpeg, is the right
  model and is what Sozi already does. Keep ffmpeg external (system, then bundled, then
  `--ffmpeg`); an npm ffmpeg dependency brings GPL binaries into the package.
- Upstream intent: #585 proposes `sozi export-video presentation.sozi.json --output
  x.mp4`, driven by the JSON with HTML regenerated first. Discussions #639 and #715 ask
  for `sozi --build my.svg` in CI without X; Electron cannot meet "without X", only xvfb.
  #519: maintainer says the title comes from Inkscape's Document Properties metadata;
  users without Inkscape are stuck; discussion #550 shows draw.io SVGs have no title.
  The docs say the JSON "must reside in the same folder as the SVG and have the same
  name", so #3 and #4 change documented behaviour and must stay opt-in.

## References

- Electron 33 docs: browser-window-options, web-contents (capturePage), app.exit,
  testing-on-headless-ci; issues electron#27893, #32060, #36376, #32001, #45398, #48982.
- drawio-desktop `src/main/electron.js` export branch; issues #1892, #2230, #1056, #2426.
- Sozi discussions #639, #715, #550, #623, #693, #624; issue #645; Sozi-export README.

- Upstream issues: sozi-projects/Sozi#585, #355, #313, #519, #722, #650, #604, #637, #716, #717, PR #759.
- Fork issues: #1 (plan), #2, #3, #4, #5.
- Spike script: not committed; results recorded above.
