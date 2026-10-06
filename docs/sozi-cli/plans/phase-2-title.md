# Phase 2 plan: explicit title (#5, upstream 519)

Spec: `docs/sozi-cli/IMPLEMENTATION.md` (Phase 2) backed by `docs/sozi-cli/RESEARCH.md`
("Title" facts). Branch `5-title` off `1-cli-foundation`; PR base `1-cli-foundation`.
Anchor issue #5.

## Global Constraints

Same as phase 1 (`docs/sozi-cli/plans/phase-1-cli-foundation.md`, Global Constraints):
commits via `gh-as builder --git commit` with the two mandatory footer lines
(`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`,
`Claude-Session: https://claude.ai/code/session_01JY226J7CY7HeDQJMs1ngym`), never push, never
touch sozi-projects/Sozi, revert `locales/messages.pot` and `yarn.lock` before committing,
`npx gulp` before Electron-spawning tests, `npm test` runs under xvfb-run, no new runtime
dependencies, tests spawn the real binary on temp copies of fixtures, stdout is one JSON
document, exit codes 0/1/2, GUI unchanged when `--cli` is absent, small diffs in existing files
(upstream PR #759 touches Presentation.js and Controller.js).

Title semantics (binding):
- JSON key `title` (string). Absent or empty means "no explicit title".
- Effective title = explicit JSON title, else the SVG root's direct `<title>` text (trimmed),
  else `"Untitled"`. The SVG title is never written into the JSON by loading or saving.
- The effective title is used for: the generated HTML `<title>`, the presenter HTML `<title>`,
  the player's runtime `document.title` (the minimal JSON embedded in the HTML must carry the
  explicit title so the player computes the same effective title), and the editor window title.
- An empty `<title/>` in the SVG must not throw (today it does: `svgTitle.firstChild` null).
- Existing decks without the key behave exactly as before (same HTML output).

## Task 1: Model and editor field

**Files:** `src/js/model/Presentation.js`, `src/js/view/Properties.js`, `src/js/player.js`
(only if needed), `test/cli/title.test.js` (new; see tests below), `test/fixtures/basic.svg`
(unchanged) and a new small fixture `test/fixtures/notitle.svg` (copy of basic.svg with the
`<title>` element removed) + `notitle.sozi.json` (copy of basic.sozi.json).

Behaviour:
- `Presentation`: keep `svgTitle` (set in `setSVGDocument` from `svg > title`, `""` when absent
  or empty; guard the null `firstChild`), add `explicitTitle` (default `""`), and make `title` a
  getter returning `explicitTitle || svgTitle || "Untitled"`. Anything that assigned
  `this.title = ...` must be updated. `toStorable` and `toMinimalStorable` write `title` only
  when `explicitTitle` is non-empty; `fromStorable` reads `title` into `explicitTitle` with
  `copyIfSet` semantics (absent key leaves `""`). Check `upgrade.js` does not touch `title`.
- The player (`src/js/player.js`, `src/js/player/Player.js`) already reads `presentation.title`;
  verify it computes the effective title after `fromStorable` and change nothing unless needed.
- `Properties.js`: add a "Title" text field in the presentation (document) properties section,
  bound through `controller.getPresentationProperty("explicitTitle")` /
  `setPresentationProperty("explicitTitle", value)`, placeholder showing the SVG title or
  "Untitled" so the user sees the fallback. Follow the existing field helpers in that file.
- Editor window title (`src/js/view/Preview.js` or wherever `document.title` is set from
  `presentation.title`) picks up the getter automatically; verify.

Tests (CLI-driven, since the CLI exists; `test/cli/title.test.js`):
- `build` on `basic` (SVG title "Basic", no JSON title): HTML `<title>` is `Basic`, JSON written
  by build has no `title` key, and the embedded `soziPresentationData` has no `title` key.
- `build` on a temp copy whose JSON has `"title": "My Talk"`: HTML `<title>` is `My Talk`;
  presenter HTML `<title>` contains `My Talk`; embedded minimal JSON has `"title":"My Talk"`;
  the JSON written back still has `"title": "My Talk"` and nothing else changed.
- `build` on `notitle` fixture: HTML `<title>` is `Untitled`, no JSON `title` key.
- Empty `<title/>` fixture made in the test (edit the SVG text): build succeeds (exit 0) and
  the title is `Untitled`.
- Runtime check: load the built HTML in headless Chrome (`/usr/bin/google-chrome --headless=new
  --disable-gpu --no-sandbox --dump-dom file://...`; if the binary is absent, skip the test
  with a note) and assert the dumped DOM's `<title>` text contains `My Talk`.
- TDD: failing tests first.

## Task 2: CLI `--title`, `set` command, inspect fields, README

**Files:** `src/js/cli/commands/build.js`, `src/js/cli/commands/set.js` (new),
`src/js/cli/commands/inspect.js`, `src/js/cli/index.js`, `src/js/cli/args.js` (no change
expected; `--title` takes a value), `test/cli/title.test.js` (extend), `README.md`.

Behaviour:
- `build --title "X"`: sets `explicitTitle` through `controller.setPresentationProperty` before
  writing, so the JSON, both HTML files and the embedded minimal JSON
  carry it; the JSON is written because the change sets `jsonNeedsSaving` (build no longer has `--no-json`; it has `--write-json` to force a rewrite). `--title ""` clears the explicit title (JSON key removed).
- New command `set`: `set --title "X" deck.svg` loads, applies the property, and writes only the
  JSON (no HTML). Result `{ok, command:"set", changed:{title:{from, to}}, files:[json]}`.
  `set` with no recognised option is a usage error (exit 2). Design the option handling so
  later phases can add more `set` options without restructuring (a small table of
  option -> presentation property).
- `inspect`: add `titleSource`: `"json" | "svg" | "default"`, and `svgTitle` (string, may be
  empty) next to the existing `title`.
- README: document `--title`, the `set` command, the fallback order, and that the SVG title
  is set in Inkscape under Document Properties > Metadata (upstream's answer) for users who
  prefer that.

Tests: `build --title`, `set --title` (JSON only; HTML absent afterwards), `set --title ""`
clears, `set` without options exits 2, `inspect` reports `titleSource` for all three cases.

## Carried from the phase 1 re-review (requirements for this task)

- In `src/js/index-electron.js`, treat a non-string `--timeout`/`--size` value (flag given without a value parses as `true`) as a usage error (exit 2) before arming the timer.
- In `src/js/cli/args.js`, use `Object.hasOwn` (or null-prototype tables) in `flagsOf`/`validateArgs` so `--toString`/`--constructor` are unknown flags; add one test.
- Move the `SOZI_CLI_TEST_HANG` early return after the in-memory preference overrides in `src/js/cli/index.js`.
