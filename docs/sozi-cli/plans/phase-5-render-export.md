# Phase 5 plan: render and export (#2, upstream 585)

Spec: `docs/sozi-cli/IMPLEMENTATION.md` (Phase 5) backed by `docs/sozi-cli/RESEARCH.md`
("Export" facts: exporter runs in the editor renderer, opens a visible window per export,
drives frames through `ipcRenderer.sendTo` which Electron 28+ removed (upstream #722), never
checks ffmpeg's exit status, unpadded sequence names, no background/transparency handling;
export settings schema `exportType`, `exportToPDF*`, `exportToPPTX*`, `exportToVideo*`;
frame-list grammar in `exporter/index-electron.js` `markFrames`).
Branch `2-render-export` off `4-out-dir`; PR base `4-out-dir`. Anchor issue #2.

## Global Constraints

Same as phases 1 to 4. Plus:
- ffmpeg stays external: system `ffmpeg` on PATH first, then the bundled
  `process.resourcesPath/ffmpeg`, then `--ffmpeg <path>`. No npm ffmpeg package.
- Captures are deterministic: frames and transition steps are driven by stepping the player
  (`player.jumpToFrame`, `player.onAnimatorStep(t)`), one capture per step; never wall-clock.
- The capture window is hidden (`show:false`, `backgroundThrottling:false`) or offscreen; it is
  never the editor window. Its size is exactly the requested pixel size; the output image size
  is checked and a mismatch is an error (screen clamping).
- `webContents.capturePage` first; if an image comes back empty (all one colour and the
  SVG has content), fall back to CDP `Page.captureScreenshot`. Record which path was used in
  the result's `warnings`.
- The GUI export must work again from a source build (closes upstream #722 in this fork).

## Task 1: Exporter rewrite as a main-process-usable module (GUI export works again)

**Files:** `src/js/exporter/index-electron.js` (rewrite the driving layer), delete or gut
`src/js/exporter/exporter-preload.js`, `src/js/Controller.js` (call sites only, minimal),
`test/cli/export-gui.test.js` (new, limited; see tests).

Behaviour:
- Replace the renderer-to-renderer IPC (`sendTo`) with the caller driving the export window
  through `webContents.executeJavaScript`: `await w.webContents.executeJavaScript("sozi.player.jumpToFrame(i)")`,
  and for transitions a small page-side helper installed by a preload (`window.__soziExport = {
  setup(nextIndex), step(t), finish() }`) called the same way. Wait for a paint before
  capturing: two `requestAnimationFrame`s via `executeJavaScript`, not a timer.
- The exporter API becomes `exportToPDF(presentationLike, htmlPath, opts)`, `exportToPPTX`,
  `exportToVideo`, where `presentationLike` is a plain object with the `exportTo*` fields and
  `frames[{timeoutMs, timeoutEnable, transitionDurationMs}]`, and `opts` carries `{outPath,
  ffmpegPath, hidden:boolean, onProgress}`. It must run in the main process (uses
  `BrowserWindow`, not `@electron/remote`) and from the renderer through `@electron/remote`
  (the GUI path), without duplicating logic.
- Fix the known defects on the way: check ffmpeg's exit status and capture stderr into the
  error; zero-pad sequence names (`img%06d.png`) in both the writer and the ffmpeg pattern;
  `-pix_fmt yuv420p` and even dimensions for mp4/webm; `return` after `onDone`; capture the
  first image of a frame even when `timeoutMs` is 0; reject on an empty frame selection; add
  `printBackground:true` for PDF; set the window `backgroundColor` to white and expose
  `transparent` for PNG sequences (`Emulation.setDefaultBackgroundColorOverride` when
  transparent).
- GUI: the Export button path (`Controller.exportTo*`) calls the new API through remote with
  `hidden:false` preserved as an option default of `true` (hidden window now works; keep a
  preference or flag to show it for debugging).
- Tests: a real-binary test that runs the GUI editor under xvfb on the basic fixture and
  triggers a PDF export through the controller is not feasible without a GUI driver; instead
  add an Electron-driven test script (`test/cli/export-gui.test.js`) that launches the built app
  with a test env hook `SOZI_TEST_EXPORT=pdf` making the editor run `controller.exportToPDF()`
  after load and exit; assert the PDF exists with the expected page count (use `pdf-lib`,
  already a dependency). Keep the hook strictly env-gated.

## Task 2: `render` command

**Files:** `src/js/cli/commands/render.js` (new), `src/js/cli/index.js`,
`src/js/index-electron.js` (main-process render support if the capture window must be created
from main), `test/cli/render.test.js` (new), `README.md`.

Behaviour:
- `render --frame <N|id> --out <file.png> deck.svg` writes one PNG of that frame at
  `--size` (default 1280x720; the camera uses the presentation aspect inside that box as the
  player does). `render --all --out <dir>` writes `frame-000.png`... (zero-padded, 0-based index)
  for every frame and reports `files`. The render uses the *built* HTML (run the build step
  first in the same process when the HTML is missing or older than the SVG/JSON; otherwise
  reuse it; `--rebuild` forces).
- Result: `{ok, command:"render", files, size:{width,height}, frames:[{index,id,file}]}`.
- Tests: PNG exists, decodes (check the PNG signature and IHDR dimensions), dimensions match
  `--size`, pixels are not uniform (sample a few rows); `--all` count equals frame count;
  unknown frame -> 1; two renders of the same frame are byte-identical (determinism).

## Task 3: `export` command and README

**Files:** `src/js/cli/commands/export.js` (new), `src/js/cli/index.js`,
`test/cli/export.test.js` (new), `README.md`.

Behaviour:
- `export deck.svg` honours the JSON's export settings; overrides `--type pdf|pptx|video`,
  `--format mp4|webm|ogv|png`, `--fps`, `--width`, `--height`, `--bitrate`, `--include`,
  `--exclude` (frame-list grammar), `--ffmpeg <path>`, `--out <path>`, `--transparent` (png
  sequence only). Builds first if needed (as `render`).
- Result `{ok, command:"export", type, format, out, frames:<count>, ffmpeg:<path|null>}`.
- Video is skipped (result `ok:false`, error "ffmpeg not found") when no ffmpeg is available;
  tests skip the video case with a reason when `ffmpeg` is absent, otherwise assert the file
  exists and `ffprobe` (if present) reports the frame count within 1 of the expected.
- README: "Render and export" subsection with examples, the display/xvfb reminder, ffmpeg
  lookup order, and the note that the GUI export now works from source builds.
- Tests: PDF page count equals selected frames (`pdf-lib`); PPTX exists and is a zip with
  `ppt/slides/slideN.xml` count equal to frames; PNG sequence count equals the stepped
  timeline length for the basic fixture (compute expected from its timings and the fps);
  include/exclude grammar cases through `--include "1:2"` etc.
