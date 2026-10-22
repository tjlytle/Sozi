# Safety Net Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the behaviour of the existing editor, player, presenter and CLI with tests that run in CI, so the cleanup PRs that bring the old code to the standard cannot change what the software does without a test going red.

**Architecture:** Four layers, cheapest first. Unit tests for the pure modules, loaded raw where they have no relative imports and from the built CommonJS under `build/electron` otherwise. Golden-image tests for `render` with a tolerance, using the existing PNG decoder. Browser scenarios (Cucumber + Playwright, the existing `world.js`) for the player and the presenter on the built deck pages. Electron scenarios for the editor through Playwright's Electron launcher, in a second support file, with an isolated `HOME` and a save-before-close rule so the quit dialog never blocks. Every test is named or annotated so `bin/check-coverage.js` sees it.

**Tech Stack:** `node:test`, Cucumber 13, Playwright 1.64 (`chromium` and `_electron`), Electron 33, the fixtures under `test/fixtures/`, `xvfb-run` in CI.

**Spec:** Tim's instruction of 2026-10-22 ("get some general tests setup so we can have confidence that porting the old code to the new standards doesn't break anything"; "I'm not sure how we do that in an electron app other than to treat it as a browser"), the standard's section 6 (`.claude/skills/code-standard/references/tests.md`), and the map at `.agents/tmp/test-surface-map.md` (regenerate it with a read-only exploration if missing).

## Global Constraints

- Tests pin current behaviour; they never change `src/`. A test that fails against today's code is a finding to record in the issue, not a reason to edit the code (file it as a bug issue with `triage`).
- Every new unit test is named after the module it covers (`test/unit/player/Timing.test.js` covers `src/js/player/Timing.js`); every feature file starts with `# covers: <paths>` and tags scenarios `@issue-<n>` with the safety-net issue number from the launch plan.
- Unit tests are ES modules; modules with relative imports are imported from `build/electron/src/js/...` (the Babel output), which `npm test` already requires (`npx gulp` first).
- Electron scenarios run under `xvfb-run -a` like everything else; each launch uses `env: {HOME: <temp dir>, ELECTRON_ENABLE_LOGGING: "1"}` and a copied deck (`withTempDeck`), never a fixture in place.
- No new dependency (standard 4): pixel comparison is written against the existing `decodePng` in `test/cli/helpers.js`; Playwright's Electron support is part of the installed package.
- Runtime budget: the whole feature suite under 3 minutes on the CI runner; each Electron scenario launches once per scenario (about 3 s).
- Commits as `builder`, tests first, the PR as the normal persona flow on branch `<safety-net issue>-safety-net`.

## Review Focus

- A golden PNG with zero tolerance breaks on a font or antialiasing change; Task 2 pins a mean-absolute-difference threshold and a test that a deliberately shifted image fails it.
- Electron's quit dialog ("save changes?") blocks a scenario that closes a modified deck; Task 4's support saves through the keyboard shortcut before `app.close()` and asserts the file was written.
- A scenario that reads renderer state through `page.evaluate` depends on `nodeIntegration`/no `contextIsolation`, which a later cleanup may change; Task 4 reads DOM text where it can and documents the one `evaluate` it keeps.
- Timeline reorder by drag is fragile under xvfb; Task 4 covers reorder through the controller's keyboard path if one exists, else records it as not covered.
- The player feature must not depend on timing: transitions are 1000 ms in the fixture; Task 3 waits on `window.sozi.player.currentFrame` through a polling step, never on a sleep.

---

### Task 1: Unit tests for the pure modules

**Files:**
- Create: `test/unit/player/Timing.test.js`, `test/unit/model/Selection.test.js`, `test/unit/model/CameraState.test.js`, `test/unit/model/Presentation.test.js`, `test/unit/upgrade.test.js`, `test/unit/cli/output.test.js`, `test/unit/cli/html.test.js`, `test/unit/support/stubs.js`
- Modify: `test/cli/run.sh` (add `"test/unit/**/*.test.js"`)

**Interfaces:**
- Produces: `test/unit/support/stubs.js` exporting `fakeLocalStorage()`, `fakeRequestAnimationFrame()` (returns `{install(), uninstall(), tick(ms)}`), `svgElementStub({x, y, width, height})` (the four getters `CameraState` reads), and `builtModule(relPath)` → `import()` of `build/electron/src/js/<relPath>` with a clear error when the build is missing.

- [ ] **Step 1: Write the Timing tests first and watch them fail on the import**

```js
// test/unit/player/Timing.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {linear, ease, easeIn, easeOut, easeInOut, stepStart, stepEnd, stepMiddle, makeBezier, makeSteps} from "../../../src/js/player/Timing.js";

describe("timing functions", () => {
    test("every curve maps 0 to 0 and 1 to 1", () => {
        for (const f of [linear, ease, easeIn, easeOut, easeInOut]) {
            assert.equal(f(0), 0);
            assert.equal(f(1), 1);
        }
    });
    test("ease-in is below linear at the start, ease-out above", () => {
        assert.ok(easeIn(0.25) < 0.25);
        assert.ok(easeOut(0.25) > 0.25);
    });
    test("steps: start jumps at once, end jumps at the end, middle halfway", () => {
        assert.equal(stepStart(0.1), 1);
        assert.equal(stepEnd(0.9), 0);
        assert.equal(stepMiddle(0.49), 0);
        assert.equal(stepMiddle(0.51), 1);
    });
    test("makeBezier(0,0,1,1) is linear within 1e-6; makeSteps(4) has four plateaus", () => {
        const b = makeBezier(0, 0, 1, 1);
        for (const t of [0.1, 0.5, 0.9]) {
            assert.ok(Math.abs(b(t) - t) < 1e-6);
        }
        const s = makeSteps(4, "end");
        assert.deepEqual([s(0.1), s(0.3), s(0.6), s(0.9)], [0, 0.25, 0.5, 0.75]);
    });
});
```

Run: `node --test test/unit/player/Timing.test.js`
Expected: FAIL on the import or an assertion; if an assertion fails against the real module, the test is wrong about today's behaviour: read `Timing.js`, fix the expectation to what the code does, and note it in the report. The value of this task is the pin, not the opinion.

- [ ] **Step 2: Repeat for Selection, CameraState, Presentation, upgrade, output, html**

Each file: four to eight tests on the observable contract, written from the module's own code, in this shape:
- `Selection`: add/remove/toggle frames and layers, `hasFrames`, `toStorable`/`fromStorable` round trip with a stub presentation exposing `frames` and `layers` arrays and an `on` no-op.
- `CameraState`: `copy` is independent; `toStorable` → `fromStorable` round trip equals; `setAtElement(svgElementStub({...}))` centres on it; `resetClipping` restores the defaults.
- `Presentation` (via `builtModule("model/Presentation.js")`): `fromStorable(basic.sozi.json)` gives two frames titled "One" and "Two"; `toStorable` after `fromStorable` deep-equals the fixture except documented defaults; `makeFrameId` is unique over 100 calls; `getFrameWithId` finds and misses.
- `upgrade` (via `builtModule("upgrade.js")`): `upgradeFromStorable` of a copy of `basic.sozi.json` is unchanged; of a hand-written old-format object (read the function for the fields it migrates) produces the new keys.
- `cli/output`: `resolveOutputDir` with and without `--out-dir`; `outputDirError` message shape.
- `cli/html`: `isStale` with newer and older mtimes; `presentationHtml` returns the path next to the SVG.

Run each with `node --test <file>`; watch each fail first on the missing import or a wrong expectation, then pass.

- [ ] **Step 3: Wire the runner, run the whole suite, commit**

Run: `npm test`
Expected: all previous tests plus the new ones pass (the two known flaky CLI tests may fail once; rerun them alone).

```bash
gh-as builder --git add test/unit test/cli/run.sh
gh-as builder --git commit -m "Safety net: unit tests for the pure modules"
```

### Task 2: Golden renders with a tolerance

**Files:**
- Create: `test/golden/render.test.js`, `test/golden/basic-1.png`, `test/golden/basic-2.png`, `test/golden/website-1.png`, `test/golden/website-5.png`, `test/golden/support/diff.js`
- Modify: `.prettierignore` (add `test/golden/*.png` if Prettier complains; PNGs are binary and ignored by extension already)

**Interfaces:**
- Produces: `meanAbsDiff(pngA, pngB) → number` in `test/golden/support/diff.js` (0 to 1, over RGB of same-size images; throws on size mismatch), using `decodePng` from `test/cli/helpers.js`.
- Produces: the golden PNGs rendered once with `render --frame <n> --size 640x360` from today's build and committed; `UPDATE_GOLDENS=1 npm test` rewrites them.

- [ ] **Step 1: Write the diff test first**

```js
// test/golden/render.test.js (first part)
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {meanAbsDiff} from "./support/diff.js";

describe("golden diff", () => {
    test("an image equals itself and differs from a shifted copy", async () => {
        const a = await fs.promises.readFile(new URL("./basic-1.png", import.meta.url));
        assert.equal(meanAbsDiff(a, a), 0);
        assert.ok(meanAbsDiff(a, shiftRight(a, 8)) > 0.02);
    });
});
```
where `shiftRight` is a test helper in the same file that re-encodes the decoded pixels shifted by 8 columns (use the encoder the CLI tests already use, or build a raw RGBA buffer and compare through `meanAbsDiff`'s decoded form; the helper may take decoded pixel arrays instead of PNG bytes if that is simpler: pick one signature and keep it).

Run: `node --test test/golden/render.test.js`
Expected: FAIL, `diff.js` missing.

- [ ] **Step 2: Implement `meanAbsDiff`, render the goldens, write the render tests**

Render: `xvfb-run -a node_modules/.bin/electron build/electron --cli render --frame 1 --size 640x360 <temp copy of basic.svg>` (check `test/cli/render.test.js` for the exact flags and output naming) for the four goldens; copy them in.

Tests: for each golden, render the same frame from a temp copy and assert `meanAbsDiff(rendered, golden) < 0.01`; with `UPDATE_GOLDENS=1` write the rendered file over the golden and pass.

Run: `node --test test/golden/render.test.js` twice.
Expected: PASS both times (determinism).

- [ ] **Step 3: Add to the runner and commit**

`test/cli/run.sh`: add `"test/golden/*.test.js"`.

```bash
gh-as builder --git add test/golden test/cli/run.sh
gh-as builder --git commit -m "Safety net: golden renders with a tolerance"
```

### Task 3: Player and presenter scenarios

**Files:**
- Create: `test/features/player/navigation.feature`, `test/features/player/api.feature`, `test/features/presenter/notes.feature`, `test/features/steps/player.steps.js`
- Modify: `test/features/support/world.js` (add `openDeck(name)` next to `openPresenter`), `test/features/steps/presenter.steps.js` (shared steps if any)

**Interfaces:**
- Produces: `openDeck(name)` → `{page}` for `<base>.sozi.html` with `window.sozi` ready (poll `window.sozi?.player`).
- Feature headers: `# covers: src/js/player.js, src/js/player/` for both player files; `# covers: src/js/presenter.js, src/templates/presenter.html` for notes.

- [ ] **Step 1: Write `navigation.feature` and watch it fail on undefined steps**

```gherkin
# covers: src/js/player.js, src/js/player/
Feature: Moving through a deck in the player

  The player is the page a deck exports; the audience sees it. These scenarios pin what
  the keys and the API do today, before the player code is reshaped.

  Background:
    Given the basic deck is built
    And the deck page is open

  @issue-N
  Scenario: The first frame is shown
    Then the player is on frame "One"
    And the page title contains "basic"

  @issue-N
  Scenario: Right arrow and left arrow move one frame
    When the key "ArrowRight" is pressed
    Then the player is on frame "Two"
    When the key "ArrowLeft" is pressed
    Then the player is on frame "One"

  @issue-N
  Scenario: Space moves forward and the URL hash follows
    When the key " " is pressed
    Then the player is on frame "Two"
    And the URL hash names frame 2
```

Run: `xvfb-run -a npm run test:features -- test/features/player/navigation.feature`
Expected: undefined steps printed with stubs.

- [ ] **Step 2: Write the steps, then `api.feature` and `notes.feature` the same way**

`api.feature`: `window.sozi.player.jumpToFrame(1)` lands on "Two"; `window.sozi.presentation.frames.length` is 2; a `postMessage` of the jump message from the page's own window moves the frame (read `player.js` for the exact message shape; pin it). `notes.feature`: the presenter shows frame "One"'s notes title; pressing Next on the presenter updates the notes; the frame counter reads "2 / 2".

Run: `xvfb-run -a npm run test:features`
Expected: PASS, all scenarios, under 60 s.

- [ ] **Step 3: Commit**

```bash
gh-as builder --git add test/features
gh-as builder --git commit -m "Safety net: player and presenter scenarios"
```

### Task 4: Editor scenarios through Playwright's Electron launcher

**Files:**
- Create: `test/features/support/electron.js`, `test/features/editor/open.feature`, `test/features/editor/frames.feature`, `test/features/editor/save.feature`, `test/features/steps/editor.steps.js`
- Modify: `cucumber.json` (nothing if `support/*.js` is already globbed; check), `.github/workflows/ci.yml` (no change expected: the features step already runs under xvfb)

**Interfaces:**
- Produces: `launchEditor(deck)` → `{app, window}` using `_electron.launch({args: [path.join(root, "build/electron"), deck.svg], env: {...process.env, HOME: tmpHome, ELECTRON_ENABLE_LOGGING: "1"}})` and `app.firstWindow()`; `closeEditor({app, window})` presses `Control+S` on the window, waits for the deck's `.sozi.json` mtime to change or 2 s, then `app.close()`; `AfterAll` closes any app left.
- Feature header: `# covers: src/js/editor.js, src/js/Controller.js, src/js/Storage.js, src/js/backend/Electron.js, src/js/view/, src/js/model/`.
- Steps read the DOM: the timeline's frame rows (find the selector in `src/js/view/Timeline.js`), `#field-title`, the toolbar buttons; one `window.evaluate` is allowed to read `sozi` state if a DOM read is impossible, and it is marked in the step with a comment.

- [ ] **Step 1: Spike the launcher (30 minutes, throwaway)**

A script in `.agents/tmp/electron-spike.mjs` that launches the built editor on a temp copy of `basic.svg` under `xvfb-run -a`, waits for the first window, prints its title and the number of timeline rows, and closes. Run it. If `_electron.launch` fails with this Electron, record why and stop the task as BLOCKED with the error: the fallback is the `SOZI_TEST_*` hook pattern the export GUI test uses, which is a different plan.

- [ ] **Step 2: Write `open.feature` first**

```gherkin
# covers: src/js/editor.js, src/js/Controller.js, src/js/Storage.js, src/js/backend/Electron.js, src/js/view/, src/js/model/
Feature: Opening a deck in the editor

  Background:
    Given the editor is open on a copy of the basic deck

  @issue-N
  Scenario: The timeline lists the frames and the first is selected
    Then the timeline shows 2 frames
    And the selected frame's title field reads "One"
    And the window title contains "basic"
```

Run: `xvfb-run -a npm run test:features -- test/features/editor/open.feature`
Expected: undefined steps.

- [ ] **Step 3: Support file, steps, then `frames.feature` and `save.feature`**

`frames.feature`: select frame 2 (click its row) → title field "Two"; add a frame (toolbar or shortcut) → 3 rows; delete it → 2 rows; undo (Ctrl+Z) after a title edit restores the title. `save.feature`: edit the title to "Uno", Ctrl+S, then the `.sozi.json` on disk has `"title": "Uno"` for frame 1 and a `.sozi.html` exists next to it. Reorder: only if `Controller` exposes a keyboard or menu path; else write "not covered: timeline drag" in the feature's prose.

Run: `xvfb-run -a npm run test:features`
Expected: PASS; total feature time under 3 minutes.

- [ ] **Step 4: Commit and run the whole suite once**

```bash
gh-as builder --git add test/features cucumber.json
gh-as builder --git commit -m "Safety net: editor scenarios through Playwright Electron"
```
Run: `npm test && xvfb-run -a npm run test:features`
Expected: PASS.

### Task 5: Coverage, CI and the PR

**Files:**
- Modify: `test/features/presenter/previews.feature` (no change unless its `# covers:` overlaps), `docs/software-factory/README.md` (one paragraph: the safety net exists, what it pins, how to update goldens)
- Verify: `node bin/check-coverage.js --base origin/master` lists the new coverage for `src/js/player/`, `src/js/model/`, `src/js/view/`, `src/js/Controller.js`.

- [ ] **Step 1: Run the coverage check and the PR checks**

Run: `npm run check:coverage -- --base origin/master && npm run check:pr`
Expected: coverage lists the new tests; `check:pr` passes on the `<n>-safety-net` branch with `Closes #<n>` in the body file.

- [ ] **Step 2: Open the PR as builder, QA comment, merge per the standard**

The PR body from the template; QA posts the scenario names and the feature report artifact link; the reviewer approves; merge as builder (standard 6.4). This PR goes through the persona flow by hand (this session), not the loop, since the loop's first run waits for Tim's secrets.
