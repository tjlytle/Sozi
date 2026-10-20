# Sozi fork: code standard

Status: draft for Tim's approval (2026-10-20). Becomes binding when the foundation
PR lands and `CLAUDE.md` points here.

Applies to the fork (`src/js`, `src/css`, `src/templates`, `test`) and to sozi-channel
(`worker/src`, `deck`). Written so that any model produces the same code. Each rule says
what we choose, what else we could have chosen, and why this one fits a presentation
player that is inlined into decks, an Electron editor, and a Worker.

Decisions already taken in the interview: the base is `master`, with the CLI stack
merged (2026-10-16); CI is the gate and builds on every merge, there is no nightly
branch; a green PR merges automatically; plans move to building automatically; the
pipeline stops for a person only on a question that needs input or an architectural
decision the standard and conventions do not settle; every UI PR carries screenshots;
the channel repo gets the same standard and pipeline; review and QA are biased
toward merging, and an improvement that is more than a simple nit becomes its own
issue rather than a reason to hold the PR.

---

## 1. Mechanics, enforced by tools

These gate the pipeline. Zero warnings: a warning is an error. The reason is the whole
point of the exercise: a rule a tool enforces is the same for every model; a rule a
reviewer enforces drifts with the reviewer.

### 1.1 Formatting: Prettier, configured to look like upstream Sozi

**Choice.** Prettier, with options matching the existing code: 4-space indent, double
quotes, semicolons, no spaces inside braces (`{index, title}`), parentheses around arrow
arguments only when needed (`evt => …`), 100 columns, LF line endings. It runs on files we
own (new directories, the CLI, tests, the channel repo) and on any file a PR creates.
Upstream files are never reformatted wholesale; a PR that touches one formats its own
hunks only.

**Alternatives.** (a) ESLint's stylistic rules alone, which is what upstream does: they
warn, they do not rewrite, so every model fixes them its own way. (b) Prettier with its
defaults (2 spaces, trailing commas, 80 columns): simplest, but every new file would look
foreign next to the 15,000 lines already here. (c) dprint or Biome: faster, same idea,
smaller ecosystem; nothing here needs the speed.

**Why.** A formatter removes formatting from review entirely: there is one way the code
can look, and the tool produces it. Matching upstream's look means a reader cannot tell
old from new, and a diff against upstream stays readable when we pull their changes.
Not reformatting upstream files is the same reason: a wholesale reformat would make
every future upstream merge a conflict.

### 1.2 Linting: ESLint, the current rule set made strict, plus a few rules that catch real bugs

**Choice.** Keep `eslint:recommended` and `jsdoc/recommended` as configured; promote
the two "warn" rules to errors; add `eqeqeq`, `no-var`, `prefer-const`, `curly`,
`no-implicit-globals`, `no-param-reassign`, `no-console` (allowed only in the logger),
`max-lines` 400, `max-lines-per-function` 50, `max-depth` 3, and from
eslint-plugin-import: `no-cycle` and `no-default-export`. `ecmaVersion` moves from 8
(2017) to 2022.

**Alternatives.** (a) Leave the config alone: it allows `==`, `var`, unused variables
and `console.log`, and each model has its own habits about all four. (b) Airbnb or
StandardJS presets: hundreds of opinions, many about formatting Prettier already owns,
and some that fight upstream's style (StandardJS bans semicolons). (c) Biome's linter:
one tool for lint and format, but the jsdoc plugin that upstream relies on has no
equivalent.

**Why.** Every added rule either prevents a class of bug (`eqeqeq` and type coercion,
`no-var` and hoisting, `no-param-reassign` and callers surprised by mutated arguments,
`no-cycle` and modules that load in the wrong order) or forces a split before a file
becomes unreviewable (the size limits). `no-default-export` is about consistency:
named exports mean an import always says what it imports, and renames are greppable.
The limits are trip-wires, not targets: the fix is a new module, never a bigger one.

### 1.3 Types: JSDoc checked by the TypeScript compiler, no TypeScript files

**Choice.** Files we own start with `// @ts-check`. Types live in JSDoc, which upstream
already requires on every public member (`@param {Frame} frame`,
`@returns {Promise<void>}`). CI runs `tsc --checkJs --noEmit` over those files. A type
error fails the build.

**Alternatives.** (a) Convert to TypeScript: the strongest checking, but a new build
step through browserify and gulp, a second syntax in the repo, and every upstream merge
touching a converted file becomes a rewrite. (b) No type checking: what upstream does;
the JSDoc is then documentation a model may or may not keep truthful. (c) Flow: dead
ecosystem.

**Why.** The JSDoc is already there and already mandatory. Checking it costs one CI step
and no build change, and it makes the comments load-bearing: a `@param` that lies fails
the build, so the documentation stays true across models. It is the closest thing
JavaScript has to PHPStan without changing the language.

### 1.4 CSS: Stylelint replaces csslint

**Choice.** `stylelint-config-standard`, plus: no `!important`, no id selectors in new
CSS, specificity at most three classes deep, no hand-written vendor prefixes, colours
and spacing only through custom properties.

**Alternatives.** (a) Keep csslint: last release 2016, it does not understand modern
CSS (custom properties, grid, nesting) and will flag or miss them. (b) No CSS lint: the
CSS is the part of this work most prone to each model's habits, since there is no type
system to catch anything.

**Why.** `!important` and id selectors are the two ways CSS becomes unmaintainable: both
win by force, so the next change needs more force. A specificity ceiling and a theme of
custom properties mean every panel is styled the same way and a colour is changed in one
place. Stylelint is the only maintained tool that enforces this.

### 1.5 Continuous integration: GitHub Actions, every check required

**Choice.** On every PR: Prettier check, ESLint, `tsc`, Stylelint, unit tests, browser
scenarios, build. All required to merge. A nightly workflow builds and publishes.

**Alternatives.** (a) Run checks only in the pipeline's QA stage: works until someone
pushes outside the pipeline, and the QA model may skip a step. (b) Pre-commit hooks:
run on the builder's machine, which for a headless session is this one, and can be
bypassed.

**Why.** The gate has to be outside any model's control. A red check on GitHub is a fact
the reviewer, QA and you all see the same way, and a merge cannot happen past it.

---

## 2. JavaScript: shape and idiom

### 2.1 ES modules, named exports, one concern per module

**Choice.** Every file is an ES module exporting named things. A module is either a
class module (PascalCase file, one class, same name as the file) or a function module
(camelCase file, related pure functions). No module-level mutable state.

**Alternatives.** (a) CommonJS `require`: what the tests use because node's test
runner needed it; the source is already ES modules, and mixing styles is the sort of
thing models do differently. (b) Default exports: fewer characters, but `import x from`
lets every file name the same thing differently. (c) Several classes per file: upstream
does this in places (`Presentation.js` holds `Frame` and `Layer` too); we do not add to
it.

**Why.** The existing presenter keeps `let presWindow` and `let presLength` at file
scope, and that is why it cannot be tested, reused or have two instances. One module,
one responsibility, no hidden state means a module can be read alone, tested alone and
replaced alone.

### 2.2 Classes for things with a lifetime, functions for things that compute

**Choice.** Anything with state and a lifetime (a panel, a transport, the workspace,
the display bridge) is a class: the constructor receives its dependencies, `dispose()`
removes every listener and timer it added. Anything that is a computation (matching
notes to frames, choosing a layout preset, encoding a message) is a pure function with
no DOM access, in a function module.

**Alternatives.** (a) Everything as classes, including the pure logic: testable only by
instantiating things that need a DOM. (b) Everything as functions and closures: the
current presenter style; lifetimes are implicit and nothing can be torn down, which
matters once panels open and close. (c) A framework's component model (React, Inferno):
see 2.6.

**Why.** The split is the testing strategy. Pure functions run in node in milliseconds
with no browser; classes with injected dependencies run with fakes (a fake transport,
a fake display). It is also the composition rule from the snake: small units with one
job, assembled in one place.

### 2.3 Dependencies are passed in; the published API is the only global

**Choice.** A class gets what it needs through its constructor. `window.sozi.player`
and `window.sozi.presenter` are each assigned in exactly one module; nothing else reads
or writes `window` for state. Add-ons use the API, never internals.

**Alternatives.** (a) Modules import a shared singleton (`import {presenter} from
"./state"`): convenient, untestable, and every model invents a different singleton.
(b) A DI container: more than this code needs; the dependency graph is a dozen objects
wired in one `main` function.

**Why.** Explicit dependencies are what make the fakes in 2.2 possible, and one
assignment of the global is what makes the API a contract: if the only way an add-on
can reach anything is through the API, then the API is what we have to keep stable,
and nothing else.

### 2.4 Events: EventEmitter in the model, DOM events in the UI, names in one table

**Choice.** State and model objects extend node's `EventEmitter`, as upstream's
`Player` does. Each emitter exports a constant table of its event names. UI code uses
DOM events on elements. No ad hoc event strings.

**Alternatives.** (a) Callbacks passed in constructors: fine for one listener, ugly for
several. (b) A custom pub/sub bus: one more thing to learn, and upstream already chose
EventEmitter. (c) RxJS or signals: powerful, large, foreign to the codebase.

**Why.** Matching upstream means a reader of `Player.js` can read `Workspace.js`. The
constant table is so a typo in an event name is a type error (1.3), not a listener that
silently never fires.

### 2.5 Protocol messages are defined once and validated before they leave

**Choice.** `src/js/protocol/` holds every message the display and surfaces exchange:
its name, its fields, an encoder and a validator. Nothing else constructs a raw
message object; it calls the protocol module, which refuses a malformed message.

**Alternatives.** (a) Post plain objects wherever needed, as today's `player.js` and
`presenter.js` do: fourteen message names scattered across two files with no list
anywhere. (b) A schema language (JSON Schema, zod): a validator we would write anyway,
plus a dependency the inlined player would carry.

**Why.** The protocol is the contract between the display, two transports, the PWA
shell, the relay Worker and the MCP server. Five consumers of one definition is the
only way they stay in agreement, and validating at the sender turns a wrong message
into a stack trace at the cause instead of a silent no-op at the receiver.

### 2.6 DOM: no framework in the player or presenter, no HTML from strings

**Choice.** The player and presenter build their DOM with `<template>` elements in the
nunjucks templates and a small `h()` helper, and set text with `textContent`. HTML
from data is never assigned with `innerHTML`; the one exception is the Markdown
renderer, whose output passes through DOMPurify. Inferno stays in the editor, where it
already is.

**Alternatives.** (a) Inferno in the presenter too: upstream uses it in the editor, but
the player and presenter are inlined into every exported deck, and a view library in
every deck is weight the deck carries forever. (b) Lit or Preact: same objection, plus
a third way of building UI in one repo. (c) Template strings and `innerHTML`: the
current presenter does `innerHTML = title`, which is an injection waiting for a frame
titled `<img onerror=…>`.

**Why.** Size and safety. A deck is a file people keep for years; what the player
carries, it carries forever. And a presenter that renders your notes as HTML has to be
told exactly where HTML is allowed, once.

### 2.7 Asynchrony and errors

**Choice.** `async`/`await` and promises; callbacks only where the DOM demands them.
Every timer and listener belongs to something with a `dispose()`. Programmer errors
throw an `Error` subclass from `src/js/errors.js`. Failures a presenter can act on
(lost connection, bad pairing code) go through the status API to a notice panel, never
`alert()`. `console` only inside the logger module, silent in production except for
errors.

**Alternatives.** (a) Callback style throughout, as parts of `Storage.js` are: nesting,
and errors that go nowhere. (b) `alert()` for failures, as the presenter does today:
blocks the page during a talk. (c) `console.log` debugging left in: every model does
it, and it is what the rule exists to stop.

**Why.** A presenter runs for an hour on a stage. Leaks (listeners never removed),
blocking dialogs, and errors swallowed into the console are the three ways it fails in
the room rather than in the test.

### 2.8 Size, documentation, text, accessibility

**Choice.** 400 lines per file, 50 per function, ten public methods per class; beyond
that, split. JSDoc with types on every export and public member. User-visible strings
through `_()` from `i18n.js`. Controls are `<button>` elements, keyboard reachable and
labelled; panels manage focus; animation honours `prefers-reduced-motion`. The
protocol and API docs are updated in the same PR as the change.

**Alternatives.** Upstream's `Controller.js` is 1,900 lines and `Presentation.js` is
1,160; both are the files nobody wants to touch. Skipping `_()` means the next
translation pass misses the presenter. Divs with click handlers instead of buttons
mean the keyboard shortcuts rule in the workspace cannot be met.

**Why.** Each is cheap at write time and expensive to retrofit, and each is a place
where models differ by default unless told.

---

## 3. CSS

### 3.1 One file per component, classes in block-element-modifier form, `sozi-` prefix

**Choice.** `presenter/panels/Notes.css` styles the notes panel and nothing else.
Classes are `sozi-notes`, `sozi-notes__section`, `sozi-notes__section--current`. No
ids for styling (ids remain for scripting hooks where upstream uses them).

**Alternatives.** (a) Upstream's style: one file per editor view, ids and descendant
selectors (`#sozi-editor-view-timeline > div`); works for one fixed layout, breaks when
a panel can appear twice or anywhere. (b) Utility classes (Tailwind): a build step,
a dependency, and HTML that carries its styling, which the nunjucks templates and
add-on panels would have to share. (c) CSS modules or CSS-in-JS: both need the
bundler to do something browserify does not.

**Why.** Dockable panels are components that move; their styles must travel with them
and not depend on where they sit. The naming form makes a selector's scope visible in
its name and keeps specificity flat, which is what lets the ceiling in 1.4 hold.

### 3.2 Theme through custom properties, dark by default, `rem` units

**Choice.** `presenter/theme.css` declares every colour, spacing step and font size as
a custom property (`--sozi-bg`, `--sozi-accent`, `--sozi-space-2`). Components use only
those. The presenter is dark by default. Sizes in `rem`. dockview's own variables are
mapped from ours in one place.

**Alternatives.** (a) Literal values in each file: the current CSS has `rgb(80, 80, 80)`
inline; a theme change is then a search and replace that misses one. (b) A
preprocessor (Sass) for variables: a build step for something CSS now does natively.
(c) Light by default: the presenter is read in a dark room next to a bright projector.

**Why.** One file defines the look; a hundred files obey it. That is also what makes a
light theme or a high-contrast theme a one-file change later.

### 3.3 Layout with flex and grid; inline styles only for computed geometry

**Choice.** Flex and grid for layout, never absolute positioning for panel internals.
JavaScript sets inline styles only for values it computes (a letterboxed preview's
width and height), never for appearance.

**Why.** The workspace resizes panels continuously; absolute layouts need JavaScript to
keep up, flex and grid do not. Keeping appearance out of JavaScript is what lets the
theme file be the theme.

---

## 4. Dependencies

**Choice.** Adding an npm package requires, in the PR body: it is named in the issue's
Implementation Plan (the architect decides, not the builder); licence MIT, BSD, Apache
2 or MPL 2; vanilla JavaScript, no framework; a release within the last year; its
minified size; pinned to an exact version with the lockfile committed; nothing loaded
from a CDN at run time. If about a hundred lines of our own code would do, write them.
Expected additions: dockview-core, marked, DOMPurify, a QR encoder.

**Alternatives.** (a) Let the builder add what it likes: each model has favourites, and
a presenter inlined into decks ends up carrying three date libraries. (b) No new
dependencies at all: hand-rolling a docking window manager is the months-long trap the
engine decision avoided.

**Why.** Decks must work offline forever, so a dependency is a permanent passenger and a
CDN load is a dead deck. Putting the decision in the plan puts it in the one document
you read per issue.

---

## 5. Change discipline

**Choice.** One issue, one branch, one PR, matching the Implementation Plan, with any
departure explained in the PR body and anything useful seen along the way filed as an
`idea` issue. Upstream files edited only as far as the issue needs: no drive-by
refactors, renames, reformatting or deletions; deprecate with a note instead. Commit
subject imperative, the why in the body; `locales/messages.pot` and `yarn.lock`
reverted before committing. A bug fix starts with a failing test. A protocol or API
change stays backwards compatible for one release.

**Alternatives.** Letting a builder "clean up while here" is how a 40-line PR becomes a
900-line one that nobody can review and that conflicts with the next upstream merge.
Deleting upstream behaviour the fork does not use saves nothing and costs every future
merge.

**Why.** The fork's value is that it stays a fork: close enough to upstream that their
fixes still apply. Everything in this section protects that, and the one-issue-one-PR
rule is what makes the QA evidence in part 6 meaningful.

---

## 6. Tests and the QA evidence

### 6.1 Unit tests in node for every pure module and every class that takes fakes

**Choice.** Node's built-in test runner, as the CLI tests already use, in `test/unit/`.
No browser. Transports, protocol, notes matching, layout matching, timers.

**Alternatives.** Jest or Mocha: features node's runner now has, plus a dependency and
a config. Vitest: needs a bundler we do not use.

**Why.** Already in use, zero dependencies, fast, and the 2.2 split guarantees there is
something to test without a browser.

### 6.2 Scenarios in Gherkin, run by Cucumber with Playwright in Chromium

**Choice.** `test/features/<issue>.feature` holds the issue's acceptance criteria as
Given/When/Then scenarios; step definitions drive the built presenter and display in
Chromium through Playwright. One feature file per issue.

```gherkin
Scenario: Notes stay put when the next frame has none
  Given a deck where frames 3, 4 and 5 share the notes written on frame 3
  And the presenter is on frame 3 with the notes panel open
  When the display moves to frame 4
  Then the notes panel has not scrolled
  And the sticky heading still says "Frame 3"
```

**Alternatives.** (a) Playwright's own test runner with descriptive test names: good
tests, but the test is code, and you said the scenario is what you read. (b) Behat-style
scenarios without a browser, driving classes with fakes: those are the unit tests; they
cannot prove a panel scrolled. (c) No browser tests, screenshots only: a picture proves
one moment, a scenario proves a behaviour on every run.

**Why.** This is the snake's Behat boards for a UI: the acceptance criteria written in
the issue are the scenarios that run, so the plan, the test and the evidence are the same
sentences. Playwright is the only browser driver with first-class Chromium, screenshot
and video support that Cucumber plugs into without ceremony.

### 6.3 What QA posts on the PR

**Choice.** One comment: the CI link with every check green; the scenarios that ran, by
name; for any PR touching a panel or CSS, two screenshots from the scenario run at
laptop and phone width; for a protocol or API change, the doc diff. A PR without that
comment is not ready.

**Why.** It is the thing you read instead of the JavaScript. Screenshots on every UI PR,
not at QA's discretion, because "is this visible?" is a judgment that varies by model.

### 6.4 CI is the gate, master is the branch, the loop stops only for a real question

**Choice.** A green PR merges into `master` automatically, as builder, with no nightly
branch in between. CI builds the Electron app and the hosted shell on every merge and
publishes them as the current build, with the merged PR in the release notes, so there
is always a build to click through that is exactly master. The pipeline parks an issue
for a person in two cases only: a question whose answer is not in the issue, the plan
or this standard; or an architectural decision this standard and the repo's
conventions do not settle (a new dependency not named in the plan, a new transport, a
change to the protocol or the published API). Everything else is decided by the
standard and checked by CI.

**Alternatives.** (a) A nightly branch promoted by hand: a second branch to keep in
step, and a day's delay between a merge and a build, for a safety net CI already
provides when every check is required. (b) Human merge of every PR: what the snake ran,
and what piled four green PRs up during the talk.

**Why.** If the gate is good enough to trust, a holding branch adds nothing but delay;
if it is not, the fix is a better gate, not a slower merge. Naming the two parking
cases is what makes "auto" safe: the loop knows exactly when it is not allowed to
decide.

### 6.5 Bias toward merging: a PR is held only for a defect, everything else is a new issue

**Choice.** Review and QA send a PR back for three things only: it does not meet an
acceptance criterion in the issue; it breaks this standard in a way CI cannot catch (a
dependency not named in the plan, data put through `innerHTML`, a second global, a
protocol change outside `src/js/protocol/`); or it introduces a security or data-loss
problem. A simple nit is fixed in the same PR and does not block it: a name, a typo, a
missing JSDoc line, a comment that lies, a one-line edge case inside the acceptance
criteria. Anything larger than that, however good the idea, becomes its own issue:
a cleaner shape, a refactor, an edge case the issue did not ask for, a performance
improvement, coverage that would be nice to have. The reviewer or QA files it with
the `idea` label and no stage label, as themselves, with a body that starts "Seen
while reviewing #<pr>:" and says what they saw and why it would be better. The PR
merges on its own merits. QA applies the same split: a failing scenario is a defect
and goes back; something noticed outside the scenarios is an issue.

**Alternatives.** (a) The reviewer asks for the improvement in the PR: the PR grows past
its issue, the builder re-plans mid-flight, and the QA evidence no longer matches the
plan; this is how a two-file change becomes a twelve-file one. (b) Mention it in the
approval comment and move on: it is lost by the next visit, since nothing in the
pipeline reads approval comments again.

**Why.** The pipeline's unit of work is the issue, and every stage is written against
it: the plan, the scenarios, the evidence. An improvement raised inside a PR has none
of that, so it gets built without a plan and checked without a scenario, which is the
thing the standard exists to prevent. Filing it as an issue costs one command and gives
the idea the same path as every other change: you decide whether it is worth doing,
and if it is, it gets planned, built, reviewed and tested like the rest. The merge bias
also keeps the loop moving: a PR that waits on a judgment call is a PR you end up
merging by hand during a talk.

---

## Future, not in the first pipeline

- **Triage before planning with a decision model.** Today every issue gets a plan. A
  decision model (TypeSafe's Jev, or Cloudflare's open-weight Clef / Clef-flash, which
  speak the same API) takes the issue text and a schema of typed questions and returns
  each answer with a calibrated probability, in tens of milliseconds and without
  generating text. The questions would be the ones a person asks when skimming an
  issue: is the cause known; is it one file; does it touch the protocol, the published
  API or more than one panel; is a dependency implied. Below a confidence threshold, or
  on any yes to the architectural questions, the issue is planned as now; otherwise it
  goes straight to building. The decision lands as a label (`plan:skip` / `plan:needed`)
  so a person can override it, and every decision is logged with its probability so
  the threshold can be tuned against what actually went wrong. Clef is the natural fit
  since the channel already runs on Cloudflare, and it can be fine-tuned on our own
  labelled issues once there are enough. Deferred until the loop has run long enough
  to show how often a plan on a simple bug was wasted, and to produce those labels.
