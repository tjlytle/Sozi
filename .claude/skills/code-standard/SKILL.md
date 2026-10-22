---
name: code-standard
description: The Sozi fork's code standard: how code in src/, test/ and packages/ is shaped, formatted, tested and reviewed. Use before writing, changing or reviewing any code in this repository.
---

# Code standard

Rules are numbered like the record they were condensed from, so "standard 2.3" names
the same rule in a hook note, a lint message, a review and this file.

## Commands (standard 1)

Zero warnings: a warning is an error. `npm run check` runs every check CI runs.

### 1.1 Formatting

Prettier, upstream look: 4 spaces, double quotes, semicolons, `{a, b}` without inner
spaces, `x => x` without parentheses, no trailing commas, 100 columns.
`bin/check --fix FILE` applies it.

### 1.2 Linting

ESLint (`config/eslintrc.mjs`): the recommended set, `jsdoc/recommended`, `eqeqeq`,
`no-var`, `prefer-const`, `curly`, `no-implicit-globals`, `no-param-reassign` (a
parameter keeps one meaning for the whole function; a changed value gets a new name).
`bin/check --fix FILE` applies the mechanical fixes; the rest is yours.

### 1.3 Types

New files are TypeScript in strict mode (`tsconfig.json`). Existing JavaScript is
checked through its JSDoc (`tsconfig.checkjs.json`). `npm run types` runs both. Node 24
runs `.ts` directly; tests and the CLI need no build.

### 1.4 CSS

Stylelint (`config/stylelintrc.json`): no `!important`, no id selectors, specificity at
most three classes deep, no hand-written vendor prefixes, colours and spacing only
through custom properties. `bin/check --fix FILE` applies what it can.

### 1.5 Continuous integration

GitHub Actions on every PR: the checks above, `npm run check:pr`, `npm run check:deps`,
`npm run check:coverage`, `npm test`, `npm run test:features`. On every merge to
master: the Electron build, the scenario report and the presenter page as artifacts. A
check is required to merge only while it is green on master.

## Boundaries every change meets

- The deck (`player/`, `player.js`, `model/`, `svg/`) never imports a surface; a surface
  never imports deck internals; `protocol/` is the only module both share (2.3).
- `window.sozi` and `window.sozi.presenter` are assigned in `player.js` and
  `presenter.js` and nowhere else; nothing reads or writes `window` for state (2.3).
- Messages between display and surfaces are built, validated and sent by
  `src/js/protocol/` only (2.5).
- HTML from data is parsed in `src/js/html/` only; everywhere else text goes through
  `textContent` or a `<template>` (2.6).
- No `alert`, `confirm` or `prompt`; failures reach the notice panel or are rethrown (2.7).
- Appearance lives in CSS; JavaScript sets an inline style only for computed geometry (3.3).

## Judgment rules (the edit hook asks; you answer)

- 2.1 One concern per module: a class module holds one class named like its file, a
  function module holds related pure functions, and nothing mutable lives at file level.
- 2.2 Classes for things with a lifetime (they take dependencies in the constructor and
  have `dispose()`); pure functions for things that compute, with no DOM access.
- 2.8 Guidelines, not limits: 400 lines per file, 50 lines of code per function, ten
  public methods per class. When the hook's note names one, ask whether the thing has
  more than one job; splitting is a choice, not a rule.
- 2.8 A summary sentence on every export; when the hook says the code changed under a
  comment that did not, read the comment again.
- 6.2 A feature file starts with `# covers: <paths>`; a unit test is named after the
  module it covers. When the hook says a file is uncovered, add a scenario or a unit
  test, or write `No test: <path> - <reason>` in the PR body.
- 6.5 A PR is held for a defect only; anything larger than a nit becomes an `idea` issue.
- 6.6 Tests first: QA writes the scenarios from the plan before the build and sees them
  fail; the builder writes each unit test before its function and pastes the red run in
  the PR. QA never touches `src/`; the builder never creates the feature file.

## Working here

- Temporary files go in `.agents/tmp/`, never committed.
- `gulp` rewrites `locales/messages.pot` and `yarn.lock`; revert both before committing.
- Every GitHub write goes through `gh-as <persona>`.

## Read when you touch it

- `references/javascript.md`: modules, classes, dependencies, events, protocol, DOM,
  asynchrony, size, text and accessibility (2.1 to 2.8).
- `references/css.md`: files, class names, tokens, units, layout (3.1 to 3.3).
- `references/dependencies.md`: what an npm package needs before it is added (4).
- `references/change.md`: branches, PRs, commits, what a PR may touch (5).
- `references/tests.md`: unit tests, scenarios, QA evidence, the gate, merging (6.1 to 6.6).

The reasoning behind each rule is in the record under `docs/software-factory/`; that
record is history, not instructions.
