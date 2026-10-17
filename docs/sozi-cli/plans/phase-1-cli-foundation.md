# Phase 1 plan: CLI foundation (inspect, build)

Spec: `docs/sozi-cli/IMPLEMENTATION.md` (Phase 1) backed by `docs/sozi-cli/RESEARCH.md`.
Branch `1-cli-foundation` in `/home/tjlytle/Projects/Sozi`. Anchor issue #1, part of #2.

## Global Constraints

- Commits: `gh-as builder --git commit -m "..."` (gh-personas is installed; bare `git commit`
  is blocked by a hook). Commit subject imperative, body explains why. Every commit message
  ends with these two lines:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01JY226J7CY7HeDQJMs1ngym`
  Never push. Never run `gh` against sozi-projects/Sozi.
- Before every commit run `git checkout -- locales/messages.pot yarn.lock` (gulp rewrites them).
- Build: `npx gulp` (default task) produces `build/electron/`. Binary: `node_modules/.bin/electron build/electron`.
  Source edits under `src/js` only take effect after `npx gulp`. New source files under `src/js/cli/`
  are picked up by the existing copy tasks only if they live under `src/js` (verify by checking
  `build/electron/src/js/cli` exists after gulp; if not, extend the gulp copy glob).
- A display is required. Tests run through `test/cli/run.sh` which uses `xvfb-run -a` when present,
  otherwise falls back to `DISPLAY=:1` with `XAUTHORITY=/run/user/1000/gdm/Xauthority` (this machine).
  Electron segfaults with no display; the CLI must detect `DISPLAY`/`WAYLAND_DISPLAY` absent before
  `ready` and exit 2 with a stderr message.
- stdout carries exactly one JSON document per run and nothing else. All logs go to stderr.
  Exit only via `app.exit(code)` from the `process.stdout.write` callback (Electron 33 ignores
  `process.exitCode`). Exit codes: 0 ok, 1 command failed, 2 usage/environment error.
- Chromium noise on stderr is acceptable; do not try to silence it.
- No new runtime npm dependencies. Tests use `node:test` + `node:assert` (Node 24).
- Test fixture: `test/fixtures/basic.svg` + `test/fixtures/basic.sozi.json`, a small hand-written
  Inkscape-style SVG (two layers with `inkscape:groupmode="layer"`, ids `layer1`, `layer2`, a
  `rect` id `r1` in layer1 and `r2` in layer2, root `<title>Basic</title>`, `width="800" height="600"`)
  and a 2-frame JSON with `referenceElementId` r1 and r2 on the matching layers. Also copy
  `/tmp/claude-1000/-home-tjlytle-Dropbox-Talks/ef46985a-de0d-40b6-afbb-f3a8e4016569/scratchpad/deck/hacksnake-edit.svg`
  and its `.sozi.json` into `test/fixtures/battlesnake/` for a real-deck test (1.7 MB total, no
  licensed library assets inside; the SVG is Tim's own drawing).
- Tests spawn the real binary (`child_process.spawnSync` on the electron binary with
  `build/electron`), on a temp copy of the fixture, and assert on stdout JSON, exit code and files.
  Each test cleans its temp dir.
- The GUI must behave exactly as before when `--cli` is absent.
- Do not refactor beyond the task. Keep diffs in existing files small (upstream PR #759 touches
  Controller.js and Presentation.js).

## Task 1: Main-process entry, hidden window, exit plumbing, test harness

**Files:** `src/js/index-electron.js`, `src/js/cli/args.js` (new, plain CommonJS-compatible
ES module like the rest of `src/js`), `test/cli/run.sh` (new), `test/cli/helpers.js` (new),
`test/cli/entry.test.js` (new), `package.json` (`"test"` script).

Behaviour:
- `src/js/cli/args.js` exports `parseArgs(argv)`: strips the electron binary and app path (`argv`
  as seen by the main process: everything before and including the first element that is not an
  Electron/Chromium switch and ends in `build/electron` or is an app dir; simplest: drop
  `process.argv.slice(0, app.isPackaged ? 1 : 2)`), ignores Chromium switches
  (`--no-sandbox`, `--disable-gpu`, anything in a small allowlist plus any `--` flag before `--cli`),
  and returns `{cli: boolean, command: string|null, positionals: string[], flags: {name: value|true}}`.
  Flags after the command: `--name value`, `--name=value`, boolean `--no-json`-style flags are
  `true`. Unit-testable without Electron (import directly in node:test).
- `index-electron.js`: before `app.on("ready")`, call `parseArgs(process.argv)`. If `cli`:
  - If neither `DISPLAY` nor `WAYLAND_DISPLAY` is set (Linux only): write
    `{"ok":false,"error":"no display; run under xvfb-run"}` to stdout, then `app.exit(2)` in the
    write callback. Do this before `ready`.
  - `process.on("uncaughtException")` -> stderr + `app.exit(1)`.
  - On `ready`, create the window with `show:false`, `width/height` from `--size WxH` (default
    1280x720), `webPreferences.backgroundThrottling:false`, plus the existing node/remote
    preferences, and `additionalArguments: ["--sozi-cli=" + JSON.stringify(parsed)]`.
    Attach `webContents.on("render-process-gone")` -> stderr + `app.exit(1)`.
  - `ipcMain.on("sozi-cli:result", (event, {code, json}) => process.stdout.write(json + "\n", () => app.exit(code)))`.
  - `ipcMain.on("sozi-cli:log", (event, line) => process.stderr.write(line + "\n"))`.
  - If `cli` and `command` is null or `--help`: print usage JSON `{"ok":false,"usage":"sozi --cli <inspect|build> [options] <file.svg>"}` and exit 2 before creating the window.
  - When not `cli`: unchanged behaviour (same window creation as today).
- `test/cli/run.sh`: runs `node --test test/cli/` under `xvfb-run -a` when `xvfb-run` exists,
  otherwise with the fallback DISPLAY/XAUTHORITY from Global Constraints. `package.json`
  `"test": "bash test/cli/run.sh"`. It does NOT run gulp (tests assume a current build; document in
  helpers).
- `test/cli/helpers.js`: `runSozi(args, {cwd})` -> `{code, stdout, stderr, json}` spawning the
  electron binary with `build/electron` and `--cli` prepended; `withTempDeck(fixtureName)` copies a
  fixture pair into a fresh temp dir and returns paths.
- Tests (`entry.test.js`): `parseArgs` unit cases (command, positional, `--size=640x480`,
  `--no-json`, Chromium switch ignored); `--cli` with no command exits 2 with usage JSON on stdout;
  `--cli build missing.svg` exits 1 with `{"ok":false,...}` (this needs the renderer side; in
  Task 1 implement the minimal renderer handler in `src/js/cli/index.js` that is invoked from
  `src/js/editor.js` when `--sozi-cli` is present in `process.argv`, validates the file exists,
  and reports `{ok:false, error:"file not found: ..."}` with code 1; no load yet);
  no-display case: spawn with `DISPLAY` and `WAYLAND_DISPLAY` removed from env, expect exit 2.
- TDD: write the failing tests first, then implement. Record RED/GREEN in the report.

## Task 2: Renderer CLI runner and the `build` command

**Files:** `src/js/cli/index.js`, `src/js/cli/commands/build.js` (new), `src/js/editor.js`,
`src/js/backend/Electron.js`, `src/js/Storage.js`, `test/cli/build.test.js` (new).

Behaviour:
- `editor.js`: after `controller.activate()` (or at the point the Electron backend is constructed),
  if `--sozi-cli=...` is in `process.argv` (renderer sees `additionalArguments`), parse it and call
  `runCli(parsed, {controller, storage: controller.storage, preferences})` from `src/js/cli/index.js`.
- `backend/Electron.js` constructor: when the CLI arg is present, skip `loadConfiguration`, skip
  the `beforeunload` handler registration, skip `openFileChooser`, and do not call `setSVGFile`
  from argv (the runner does it). Otherwise unchanged. The existing "last argv element is the
  file" logic must still work for the GUI.
- `Storage.js`: `openJSONFile` awaits `createHTMLFile` and `createPresenterHTMLFile`;
  `createHTMLFile` awaits its `backend.save`. `setSVGFile` resolves only after `openJSONFile`
  completes (it already awaits `backend.load` -> `loadSVGData` -> `openJSONFile`; verify and fix
  if any link is un-awaited). Behaviour for the GUI is unchanged apart from ordering.
- `cli/index.js` `runCli`: 
  - set in memory (no `preferences.save()`): `animateTransitions=false`, `saveMode="manual"`,
    `reloadMode="manual"`; never call `backend.doAutosave()`.
  - replace `controller.error` and `controller.info` with collectors (`errors[]`, `warnings[]`)
    that also forward to `ipcRenderer.send("sozi-cli:log", ...)`.
  - resolve the positional file to an absolute path against `process.env.PWD || process.cwd()`;
    if missing -> result `{ok:false, error}` code 1.
  - look up the command in a table; unknown -> usage result code 2.
  - `await storage.setSVGFile(file, electronBackend)` where `electronBackend` is the Electron
    backend instance already created by `storage.activate()` (find it in `storage.backends` or
    keep a reference when constructing).
  - run the command, which returns `{ok, ...}`; send `ipcRenderer.send("sozi-cli:result",
    {code, json: JSON.stringify(result)})`. Any thrown error -> `{ok:false, error: message,
    stack}` code 1.
  - The result always includes `command`, `svg` (absolute path), `presentation` (JSON path),
    `warnings`, `errors`.
- `build` command: after load, writes `<base>.sozi.html` and `<base>-presenter.sozi.html` with
  `storage.exportHTML()` / `storage.exportPresenterHTML(htmlName)` through `fs.writeFileSync`
  (not the autosave path), and rewrites `<base>.sozi.json` from `storage.getJSONData()` unless
  `--no-json`. Reports `files: [absolute paths written]`. Adds a warning
  `"svg newer than existing html"` when, before writing, the SVG mtime is newer than an existing
  HTML's mtime. The result also reports `frames: <count>`.
- Tests (`build.test.js`): on `basic` fixture, build writes both HTML files (exist, non-empty,
  HTML contains `soziPresentationData`), and the JSON is byte-identical to the fixture when
  `--no-json`; without `--no-json` the JSON parses and has the same `frames.length`; the stale
  warning appears when the HTML is touched older than the SVG; on the `battlesnake` fixture build
  succeeds with `frames: 32` and the HTML is within 10% of the size of a reference HTML produced
  by opening the deck in the GUI (reference: the `.sozi.html` the editor wrote in
  `/tmp/claude-1000/-home-tjlytle-Dropbox-Talks/ef46985a-de0d-40b6-afbb-f3a8e4016569/scratchpad/deck/`;
  copy it into the fixture dir as `hacksnake-edit.reference.sozi.html`). Compare after stripping
  nothing; if the size test is flaky, compare the extracted `soziPresentationData` JSON instead
  and say so in the report.
- TDD as in Task 1.

## Task 3: `inspect` command and README

**Files:** `src/js/cli/commands/inspect.js` (new), `src/js/cli/index.js` (register),
`test/cli/inspect.test.js` (new), `README.md`.

Behaviour:
- `inspect` loads the deck like `build` but writes nothing (no HTML, no JSON; must leave the
  temp dir's file set unchanged). Output:
  ```
  {ok:true, command:"inspect", svg, presentation, title, aspect:{width,height},
   layers:[{id, label, index, inJson:boolean}],
   frames:[{index, id, title, timeoutMs, timeoutEnable, transitionDurationMs, showInFrameList,
     layers:{<layerId>:{referenceElementId, referenceMissing:boolean, outlineElementId,
       link, camera:{cx,cy,width,height,angle,opacity,clipped}}}}],
   warnings, errors}
  ```
  `layers` lists every top-level layer group of the SVG (`presentation.layers`, including the
  auto layer when it exists) with `inJson` true when any frame has `layerProperties` for it.
  `referenceMissing` is true when `referenceElementId` is set but `document.getElementById`
  returns null.
- `--frame N` (0-based index or frame id) restricts `frames` to that one; unknown -> code 1.
- README: new section "Command line" documenting `--cli build`, `--cli inspect`, `--size`,
  `--no-json`, `--frame`, exit codes, the display/xvfb requirement, and that the editor must be
  closed on the same deck.
- Tests: schema fields present on `basic`; `referenceMissing` true after the test edits the
  fixture JSON to point a layer at `nope`; `--frame 1` returns one frame; `--frame 9` exits 1;
  no files are created or modified by inspect (compare directory listing and mtimes).
