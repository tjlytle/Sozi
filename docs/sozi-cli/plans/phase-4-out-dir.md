# Phase 4 plan: output directory (#4, upstream 313)

Spec: `docs/sozi-cli/IMPLEMENTATION.md` (Phase 4) backed by `docs/sozi-cli/RESEARCH.md`
("Names" facts: HTML keeps relative hrefs verbatim; presenter loads the player by bare file
name; custom CSS/JS are inlined). Branch `4-out-dir` off `3-presentation-name`; PR base
`3-presentation-name`. Anchor issue #4.

## Global Constraints

Same as phases 1 to 3 (see `phase-1-cli-foundation.md` Global Constraints). Plus:
- Phase 3 introduced one naming helper on `Storage` yielding `{svg, presentation, html,
  presenter}`; every path decision in this phase goes through it. Do not add a second one.
- Output-directory semantics (binding):
  - Optional JSON key `outputDir`: a path relative to the presentation file's directory
    (forward slashes). Absent means "beside the presentation file" (today). The key is written
    only when set; existing decks gain nothing.
  - CLI flag `--out-dir <dir>` on `build` (and `set --out-dir` to store it; `set --out-dir ""`
    clears it) overrides or stores the key. `build --out-dir` without storing is allowed:
    `--out-dir` alone writes there once; `set --out-dir` persists it.
  - Both HTML files go to the output directory (created if missing). The JSON stays beside
    the SVG/presentation; the SVG is never copied.
  - Relative asset references in the generated HTML must still resolve from the new
    location: for every `<image>` `href`/`xlink:href` and every `sozi:src` on media elements
    that is relative (no scheme, not starting with `/` or `#` or `data:`), rewrite it to
    `path.relative(outDir, path.join(svgDir, href))` with forward slashes. Absolute, scheme,
    fragment and data URLs are untouched. Custom CSS `url(...)` is out of scope (document it).
  - The editor honours a stored `outputDir` on autosave (the GUI writes its HTML there), with
    the same rewriting, since `exportHTML` is shared.

## Task 1: Storage output location and href rewriting

**Files:** `src/js/Storage.js`, `src/js/model/Presentation.js` (`outputDir` key in the three
storable methods only), `test/cli/out-dir.test.js` (new), fixture `test/fixtures/linked/`
(new: `linked.svg` referencing `img/dot.png` via a relative `xlink:href`, a 1x1 PNG at
`test/fixtures/linked/img/dot.png`, and `linked.sozi.json` with one frame).

Behaviour:
- Naming helper gains the output location: html/presenter paths are in
  `presentation.outputDir` resolved against the presentation's directory when set.
- `exportHTML()` rewrites relative hrefs when the output directory differs from the SVG
  directory (string or DOM rewrite over the serialized SVG text; keep it in one function with
  unit-testable input/output, e.g. `rewriteRelativeHrefs(svgText, svgDir, outDir)` exported
  from a small module under `src/js/` and covered by node:test without Electron).
- GUI: `createHTMLFile`/`createPresenterHTMLFile` use the helper's paths; directory created
  if missing (`fs.mkdirSync` recursive in the Electron backend `create`/`save` path, or in
  Storage before saving; pick the smallest change).
- Tests: unit cases for the rewriter (relative up/down, absolute, `http:`, `#id`, `data:`,
  `xlink:href` and `href`, `sozi:src`); real-binary test: `build --out-dir site/talk
  linked.svg` creates `site/talk/linked.sozi.html` and `-presenter`, no HTML beside the SVG,
  and the rewritten href is `../../img/dot.png`; default build unchanged (no rewrite, same
  bytes as before for `basic`).

## Task 2: CLI flags, inspect, README, runtime check

**Files:** `src/js/cli/commands/build.js`, `set.js`, `inspect.js`, `src/js/cli/index.js`,
`test/cli/out-dir.test.js` (extend), `README.md`.

Behaviour:
- `build --out-dir <dir>` (value-taking; flag table), `set --out-dir <dir>` stores the key
  (JSON only), `set --out-dir ""` clears it. `inspect` reports `outputDir` (resolved absolute
  or null) and `outputSource: "flag" | "json" | "default"`.
- `build` result `files` lists the real written paths.
- Runtime check test: load the built HTML from the output directory in headless Chrome
  (`/usr/bin/google-chrome --headless=new --disable-gpu --no-sandbox --dump-dom`, or
  `--screenshot` plus a pixel check if dump-dom cannot prove the image loaded) and assert the
  linked image resolved (e.g. inject nothing; check via `--dump-dom` that `<image>` href
  equals the rewritten path, and separately that the file exists at that path relative to
  the HTML; a full `naturalWidth` check is optional and may be skipped with a reason).
- README: "Output directory" subsection: flag, stored key, what is rewritten and what is
  not (custom CSS urls), and that the JSON stays beside the source.
- Tests: stored key honoured by `build` without the flag; flag overrides stored key;
  `set --out-dir ""` removes the key; error: `--out-dir` pointing at a file -> exit 2.
