# Phase 3 plan: presentation file independent of the SVG name (#3, upstream 355)

Spec: `docs/sozi-cli/IMPLEMENTATION.md` (Phase 3) backed by `docs/sozi-cli/RESEARCH.md`
("Names" facts). Branch `3-presentation-name` off `5-title`; PR base `5-title`. Anchor issue #3.

## Global Constraints

Same as phases 1 and 2 (see `phase-1-cli-foundation.md` Global Constraints: builder commits
with the two mandatory footer lines, never push, never touch upstream, revert
`locales/messages.pot` and `yarn.lock`, `npx gulp` before tests, `npm test` under xvfb-run,
no new runtime dependencies, real-binary tests on temp copies, one JSON document on stdout,
exit codes 0/1/2, GUI unchanged for existing decks, small diffs in existing files).

Naming semantics (binding):
- Today: `X.svg` -> `X.sozi.json`, `X.sozi.html`, `X-presenter.sozi.html`, all beside the SVG.
  This stays the default and must produce byte-identical names for every existing deck.
- New: a presentation file may have any name ending in `.sozi.json`. It records its SVG in a
  new optional JSON key `svg`: a path relative to the JSON file's directory (forward slashes).
  When the key is absent, the SVG is `<base>.svg` beside the JSON (today's rule, inverted).
- Derived output names come from the **presentation** base name, not the SVG's: `talk-es.sozi.json`
  -> `talk-es.sozi.html`, `talk-es-presenter.sozi.html`, written beside the JSON.
  (Phase 4 adds a separate output directory; do not pre-build it, but keep one naming helper.)
- Opening by SVG path keeps today's behaviour. Opening by `.sozi.json` path (CLI positional,
  editor argv, editor file chooser) resolves the SVG through the `svg` key and loads it.
- Images, media and custom files keep resolving relative to the SVG directory (unchanged).
- The JSON must not gain an `svg` key when the SVG is the default beside it (no churn for
  existing decks).

## Task 1: One naming helper on Storage, used by the GUI and the CLI

**Files:** `src/js/Storage.js`, `src/js/cli/index.js`, `src/js/cli/commands/build.js`,
`src/js/cli/commands/set.js`, `test/cli/naming.test.js` (new, unit-level if the helper can be
imported in node:test; otherwise through the binary).

Behaviour:
- Add to `Storage` a single place that knows the file set: given the SVG path and an optional
  presentation path, it yields `{svg, presentation, html, presenter}` absolute paths. Default:
  presentation = `replaceFileExtWith(svg, ".sozi.json")`; html/presenter from the
  presentation base name (which equals the SVG base name in the default case, so names are
  unchanged). Export `replaceFileExtWith` or the helper so the CLI stops re-deriving names
  with its own regex (final-review Minor 6; three copies today: `cli/index.js`, `build.js`,
  `Storage.js`).
- `Storage.openJSONFile`/`loadSVGData`/`createHTMLFile`/`createPresenterHTMLFile` take their
  names from the helper. GUI behaviour identical for the default case (prove with the existing
  tests: build output names unchanged, and the task-1 entry tests).
- Tests: helper cases (default; explicit presentation name beside the SVG; presentation in
  another directory; Windows-style backslash input not required).

## Task 2: `svg` key, open-by-JSON, `--presentation`

**Files:** `src/js/Storage.js`, `src/js/backend/Electron.js` (argv and file chooser accept
`.sozi.json`), `src/js/model/Presentation.js` (store/load the `svg` key only; do not touch
Controller), `src/js/cli/index.js`, `src/js/cli/commands/build.js`, `inspect.js`, `set.js`,
`test/cli/presentation-name.test.js` (new), `README.md`.

Behaviour:
- JSON key `svg` (relative path from the JSON's directory). `toStorable` writes it only when the
  SVG is not `<base>.svg` beside the JSON; `fromStorable` reads it; `Storage` uses it when a
  presentation path is opened directly.
- CLI: positional may be `deck.svg` (today) or `talk.sozi.json` (new). Flag
  `--presentation <path>` (value-taking; add to the build/inspect/set flag tables) names the
  presentation file explicitly when the positional is an SVG; if the file does not exist it is
  created from the SVG (like today's first open) with the `svg` key set when needed. `inspect`
  reports `svg` and `presentation` (already) plus `svgSource: "default" | "json" | "flag"`.
- Editor: `electron build/electron talk.sozi.json` opens that presentation; the file chooser
  filter accepts `*.sozi.json` as well as SVG (one filter entry). Opening a JSON whose `svg`
  target is missing shows the existing error notification path.
- Error cases: positional JSON without `svg` key and no `<base>.svg` beside it -> exit 1 with a
  clear message; `--presentation` pointing to a directory -> exit 2.
- README: a "Several presentations from one SVG" subsection with the `--presentation` example,
  the `svg` key, and the note that output names follow the presentation file.
- Tests (real binary): two presentations built from one SVG in the same directory yield two
  HTML pairs named after the presentations and the original `basic.sozi.html` is not written;
  presentation in a subdirectory with `svg: "../basic.svg"` builds there; opening by JSON
  positional works for both inspect and build; default decks produce no `svg` key and
  unchanged names; the error cases above; the task-1 and task-2 title tests still pass.
