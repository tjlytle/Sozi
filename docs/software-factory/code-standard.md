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

**Decided 2026-10-20: Prettier, upstream look.** Options: 4-space indent, double quotes,
semicolons, no spaces inside braces (`{index, title}`), parentheses around arrow
arguments only when needed (`evt => …`), no trailing commas, 100 columns, LF line endings.

**Scope, decided 2026-10-20: every file, no allow list.** Prettier runs on all of
`src/js`, `test` and the channel repo. The one-time reformat of upstream files is a
cleanup, deferred until the factory exists (see "Cleanups" at the end of section 1).
Upstream last changed `src/js` or `src/css` on 2024-11-17; since 2024, 86 of its 106
commits are dependabot bumps, so keeping upstream files mergeable is not a goal.

**Measured 2026-10-20.** The closest Prettier config still rewrites 4,891 of 15,816 lines
in `src/js` (52 of 55 files). Prettier cannot reproduce two upstream habits: `else` on its
own line after `}` (Prettier forces `} else {`) and hand-aligned object literals. So
"upstream look" is approximate, and reformatting upstream files would make every upstream
merge conflict in those regions. Files we own never conflict because upstream does not
have them.

**Alternatives.** (a) ESLint's stylistic rules alone, which is what upstream does: they
warn, they do not rewrite, so every model fixes them its own way. (b) Prettier with its
defaults (2 spaces, trailing commas, 80 columns): simplest, but every new file would look
foreign next to the 15,000 lines already here. (c) dprint or Biome: faster, same idea,
smaller ecosystem; nothing here needs the speed.

**Why.** A formatter removes formatting from review entirely: there is one way the code
can look, and the tool produces it. Matching upstream's look as closely as Prettier can
means a reader mostly cannot tell old from new. Not reformatting upstream files keeps
upstream merges clean.

### 1.2 Linting: ESLint, the current rule set made strict, plus a few rules that catch real bugs

**Decided 2026-10-20.** Keep `eslint:recommended` and `jsdoc/recommended` as configured;
promote the two "warn" rules (`no-unused-vars`, `no-prototype-builtins`) to errors; add
`eqeqeq`, `no-var`, `prefer-const`, `curly`, `no-implicit-globals`, `no-param-reassign`.
`ecmaVersion` moves from 8 (2017) to 2022: with 8, ESLint cannot parse object spread and
fails on `src/js/model/Presentation.js` and `src/js/cli/commands/set.js` today. Zero
warnings: the lint step fails on any warning.

**Dropped by Tim:** `no-console` (models may log freely); the size limits (`max-lines`,
`max-lines-per-function`, `max-depth`); and eslint-plugin-import (`no-cycle`,
`no-default-export`). Oversized files are the reviewer's call, not a lint failure.

**Scope: every file, same as 1.1.** The strict set over all of `src/js` today finds
243 problems in 31 files; `eslint --fix` clears 112 (mostly `let` to `const`), 131 need
a hand (58 unused variables, 36 JSDoc types not imported, 16 parameter reassignments,
9 prototype-builtin calls, 7 loose comparisons, 8 JSDoc gaps). That cleanup is deferred
(see "Cleanups" below). `no-param-reassign` kept in its default form (decided 2026-10-20): a parameter keeps one
meaning for the whole function; a changed value goes in a new variable. Its 16 existing
sites are rewritten in the initial cleanup pass.

**Alternatives.** (a) Leave the config alone: it allows `==`, `var`, unused variables
and `console.log`, and each model has its own habits about all four. (b) Airbnb or
StandardJS presets: hundreds of opinions, many about formatting Prettier already owns,
and some that fight upstream's style (StandardJS bans semicolons). (c) Biome's linter:
one tool for lint and format, but the jsdoc plugin that upstream relies on has no
equivalent.

**Why.** Every added rule prevents a class of bug: `eqeqeq` and type coercion, `no-var`
and hoisting, `no-param-reassign` and callers surprised by mutated arguments. The
current code already has 0 `var`s, 7 loose comparisons (all upstream) and 0 default
exports, so the rules codify what is mostly already true.

### 1.3 Types: TypeScript, adopted gradually; existing JavaScript checked through its JSDoc

**Decided 2026-10-20: TypeScript is the end state, reached gradually.** The foundation
PR adds `tsconfig.json` with `allowJs` and `checkJs`, so `tsc --noEmit` checks every
existing `.js` file through its JSDoc immediately, with no build change. New files are
written in TypeScript (`.ts`) in strict mode. The CLI and the tests need no build step
for this: Node 24 runs `.ts` directly (verified 2026-10-20). Converting the 55 existing
files (15,816 lines) and adding the TypeScript transform to the gulp/Babel/Browserify
chain is an early factory epic, verified against the render fixtures; it is filed with
the other deferred cleanups, not done before the factory runs.

**Two configs.** `tsconfig.json` is strict and covers `.ts` files only; it is green from
day one and is the required check for new code. `tsconfig.checkjs.json` extends it,
turns `checkJs` on over every `.js` file and turns `noImplicitAny` off, because an
untyped parameter is not a lying comment. It is red until the conversion epic clears it,
and its count falls as files convert. `src/js/types/global.d.ts` holds ambient types.

**Measured 2026-10-20.** Strict config: 0 errors. Legacy config: 544 errors across
`src/js` and `test`. One class is structural: the gulp build renames
`exporter/index-electron.js` to `exporter/index.js`, so `import "./exporter"` resolves
only after a build; the cleanup maps it with `paths` or a re-export. Some are inference, not lying comments: in the
CLI export command, `const set = (flag, key, convert = String)` makes tsc infer that
`convert` must be `String`, and the next lines pass `Number`. The fix is a one-line type
annotation. Those fixes are part of the deferred cleanup.

**Alternatives.** (a) JSDoc checked by tsc, no TypeScript ever: zero build change, but a
function without a comment is unchecked, and the point is code nobody reads. (b) Convert
everything in the foundation PR: contrary to the deferral rule. (c) No type checking:
what upstream does; the JSDoc is then documentation a model may or may not keep truthful.
(d) Flow: dead ecosystem.

**Why.** With strict TypeScript every function must type-check, which is the strongest
deterministic guarantee available for generated code. JSDoc checking is the same tool and
the same config, so starting there costs nothing and converts file by file. The
upstream-merge argument against converting no longer applies (see 1.1).

### 1.4 CSS: Stylelint replaces csslint

**Decided 2026-10-20: standard preset plus all extras.** `stylelint-config-standard`, plus: no `!important`, no id selectors in new
CSS, specificity at most three classes deep, no hand-written vendor prefixes, colours
and spacing only through custom properties.

**Measured 2026-10-20.** csslint reports nothing on the five editor stylesheets. The
Stylelint standard preset finds 99 problems; its `--fix` clears 78 (colour notation),
21 need a hand (14 duplicate selectors, specificity order). Today: 0 `!important`, 9 id
selectors (one id, in `Preview.css`), 6 vendor prefixes, 53 colour literals of 4 distinct
colours, 0 custom properties. The theme block and the 53 replacements are a deferred
cleanup.

**Alternatives.** (a) Keep csslint: last release 2016, it does not understand modern
CSS (custom properties, grid, nesting) and will flag or miss them. (b) No CSS lint: the
CSS is the part of this work most prone to each model's habits, since there is no type
system to catch anything.

**Why.** `!important` and id selectors are the two ways CSS becomes unmaintainable: both
win by force, so the next change needs more force. A specificity ceiling and a theme of
custom properties mean every panel is styled the same way and a colour is changed in one
place. Stylelint is the only maintained tool that enforces this.

### 1.5 Continuous integration: GitHub Actions, every check required, build on every merge

**Decided 2026-10-20.** On every PR: Prettier check, ESLint, `tsc --noEmit`,
Stylelint, unit tests, browser scenarios, build. All required to merge. On every merge to
`master`, CI builds the Electron app and the hosted shell and publishes them as artifacts.
There is no nightly workflow; "nightly" in the interview meant "a build I can click
through", and every-merge gives that with no delay. The repo has no `.github/workflows`
today; nothing runs on a PR.

**One command runs every check locally.** `npm run check` runs the same steps CI runs,
in the same order, so a person or a model gets the CI answer without pushing. A Claude
Code hook (alongside the existing repo-lock hook) runs the formatter and linter on each
file as a model edits it, so the model sees a failure before it commits. The hook is the
fast path; CI is the only gate.

**Alternatives.** (a) Run checks only in the pipeline's QA stage: works until someone
pushes outside the pipeline, and the QA model may skip a step. (b) Pre-commit hooks
alone: run on the builder's machine, which for a headless session is this one, and can be
bypassed.

**Why.** The gate has to be outside any model's control. A red check on GitHub is a fact
the reviewer, QA and you all see the same way, and a merge cannot happen past it.

### Cleanups: one-time fixes are the factory's first issues, not part of its setup

**Decided 2026-10-20.** Tim's priority is the rule set, the deterministic checks and the
hooks that make the factory safe to run. Any one-time fix those checks demand on the
existing code (the Prettier reformat, the 131 hand lint fixes, and whatever 1.3 and 1.4
find) is filed as the first issues the factory works, not done by hand before it starts.
Until a cleanup issue merges, its CI check runs but is not required; it becomes required
in the same PR that clears it, so a check is never required while red.

---

## 2. JavaScript: shape and idiom

### 2.1 ES modules, named exports, one concern per module

**Decided 2026-10-20.** Every file is an ES module (`import`/`export`), tests included;
CommonJS `require` is not written in new code and the 15 existing test files convert in
the cleanup (or move to TypeScript, where the question does not arise). Exports are
named; `export default` is banned by `import/no-default-export`, with tool configs
(`config/*.mjs`, `gulpfile.js`) exempt because ESLint and gulp read a default export.
Import cycles are banned by `import/no-cycle`. Both rules find nothing in the current
code: 0 default exports, 0 cycles.

A module is either a **class module** (PascalCase file, one class, same name as the file:
`model/Selection.js` exports `Selection`) or a **function module** (camelCase file,
related functions with no state between calls: `naming.js` exports six path helpers).
A file does not export two classes, and does not mix a class with loose functions.

**No module-level mutable state.** A `const` at file level is fine when its value never
changes (`PRESENTATION_EXT`, a flag table). A `let` at file level, or a `const` array or
object that code pushes into or assigns to, is a global: there can be one of it, and no
test can start it fresh. State lives in an instance of a class, or is passed in. Today
nine files keep `let` at file level (`player/FrameList.js` 8, `player/TouchGestures.js` 7,
`presenter.js` 3, ...) and two keep registries (`backendList`, `animatorList`); those are
the "module as singleton" pattern the presenter rewrite replaces with classes.

**Cleanup (Tim, 2026-10-20): old code is brought to the same shape, not left doing
things differently.** `model/Presentation.js` (4 classes) and `svg/SVGDocumentWrapper.js`
(2 classes) split into one class per file; the nine singleton modules become classes.
Filed with the other cleanups (section 1, "Cleanups"), done by the factory.

**Alternatives.** (a) CommonJS `require`: what the tests use because node's test
runner once needed it; the source is already ES modules, and mixing styles is the sort
of thing models do differently. (b) Default exports: fewer characters, but `import x
from` lets every file name the same thing differently. (c) Several classes per file:
upstream does this in two files; we do not add to it, and the cleanup removes it.

**Why.** The existing presenter keeps `let presWindow` and `let presLength` at file
scope, and that is why it cannot be tested, reused or have two instances. One module,
one responsibility, no hidden state means a module can be read alone, tested alone and
replaced alone. Named exports and no cycles are what make "find every use of X" a
single grep and module loading order a non-issue.

### 2.2 Classes for things with a lifetime, functions for things that compute

**Decided 2026-10-20.** Anything with state and a lifetime (a panel, a transport, the
workspace, the display bridge) is a class: the constructor receives its dependencies,
and if it registers a listener or a timer it has a `dispose()` that removes every one it
added. Anything that is a computation (matching notes to frames, choosing a layout
preset, encoding a message) is a pure function with no DOM access, in a function module.

**Enforced.** `no-restricted-globals` bans `window`, `document` and `navigator` in
lowercase (function) files; the entry points, where the DOM is handed in, are listed by
name in `config/eslintrc.mjs` (`editor.js`, `player.js`, `presenter.js`,
`index-electron.js`, `cli/index.js`, `exporter/exporter-preload.js`). Today it finds
five uses in `i18n.js`, which reads the browser language itself; the cleanup makes the
caller pass the language in. `dispose()` cannot be linted: the class's unit test (6.1)
creates it with fakes, calls `dispose()`, and checks the fakes have nothing registered.

**What it means for existing code.** Upstream's classes (player, camera, controller)
already take dependencies through the constructor and stay as they are; none has a
`dispose()` because the editor and player never tear anything down (61 listeners added,
7 removed; 15 timers started, 9 cleared). The singleton modules of 2.1 become classes in
the cleanup, and the presenter rewrite follows this rule from the start.

**Alternatives.** (a) Everything as classes, including the pure logic: testable only by
instantiating things that need a DOM. (b) Everything as functions and closures: the
current presenter style; lifetimes are implicit and nothing can be torn down, which
matters once panels open and close. (c) A framework's component model (React, Inferno):
see 2.6.

**Why.** The split is the testing strategy. Pure functions run in node in milliseconds
with no browser; classes with injected dependencies run with fakes (a fake transport,
a fake display). A class without `dispose()` is the stacked-listener bug waiting: open
a panel five times and five of them react to every event. It is also the composition
rule from the snake: small units with one job, assembled in one place.

### 2.3 Dependencies are passed in; the published API is the only global

**Decided 2026-10-20.** A class gets what it needs through its constructor. Each entry
point has one wiring function that creates every object and hands each to the next; in
the deck that is the load handler of `player.js`, and the presenter gets one of the same
shape. `window.sozi` (the deck API) and `window.sozi.presenter` are each assigned in
exactly one module; nothing else reads or writes `window` for state. Add-ons, the
presenter first among them, use the API and never internals, so the API has to offer
what they need (the protocol issue, #25, defines that).

**The deck never depends on a surface (Tim, 2026-10-21).** The slides expose an API,
reachable locally (same page, `postMessage`) or remotely (the relay, with auth), and
everything else is a separate thing that talks to that API. Any number of surfaces may
exist at once, built any way: a lightweight presenter with no framework and a full one on
a framework are both fine, neither touches the deck, and neither blocks the other. Deck
code (`player/`, `player.js`, `model/`, `svg/`) never imports a surface; a surface never
imports deck internals; `protocol/` is the only module both sides share.

**Enforced.** `import/no-restricted-paths` bans those imports in both directions.
`no-restricted-syntax` bans assigning any `window` property outside
`player.js` and `presenter.js`. Today it finds one, in `exporter/exporter-preload.js`.
Reading internals through the API is a review rule.

**Cleanup.** The exporter preload reaches into internals (`viewport.cameras`,
`player.setupTransition`, `player.onAnimatorStep`) to render video frame by frame. The
cleanup gives the API the two calls it needs (prepare a transition, step it) and the
exporter uses those, so the API is a real contract before the presenter builds on it.
Today `window.sozi` also exposes `viewport` and `playerController`; whether those stay
public is settled in #25.

**Alternatives.** (a) Modules import a shared singleton (`import {presenter} from
"./state"`): convenient, untestable, and every model invents a different singleton; it
is the hidden global of 2.1 behind an import. (b) A DI container: more than this code
needs; the dependency graph is a dozen objects wired in one function.

**Why.** Explicit dependencies are what make the fakes in 2.2 possible, and one
assignment of the global is what makes the API a contract: if the only way an add-on
can reach anything is through the API, then the API is what we have to keep stable,
and nothing else.

### 2.4 Events: EventEmitter in the model, DOM events in the UI, names in one table

**Decided 2026-10-20.** State and model objects extend node's `EventEmitter`, as
upstream's `Player` does (so do the presentation, the player controller, the animator
and the editor controller). Each emitter exports a constant table of its event names
(`export const PlayerEvents = {frameChange: "frameChange", ...}`), and every `on` and
`emit` uses the table. UI code uses DOM events on elements. No ad hoc event strings.

**Enforced (Tim asked for the lint, 2026-10-20).** `no-restricted-syntax` bans a string
literal as the first argument of `on`, `once`, `off`, `emit`, `addListener`,
`removeListener` and `prependListener`. Electron and node glue subscribes to events whose
names are not ours (`app.on("ready")`, `process.on("exit")`, a file watcher), so it is
split out by file and exempt: `src/js/**/*-electron.js` and `src/js/backend/Electron.js`.
Electron and node code goes in those files and nowhere else. A third-party emitter
elsewhere (today one: `screenfull.on("change")` in the toolbar) gets an
`eslint-disable-next-line` with the reason on the line. Today the rule finds 88 sites in
17 files, all in-repo names, for the cleanup. Once an emitter is TypeScript, its `on()`
also refuses any name not in the table.

**Alternatives.** (a) Callbacks passed in constructors: fine for one listener, ugly for
several. (b) A custom pub/sub bus: one more thing to learn, and upstream already chose
EventEmitter. (c) RxJS or signals: powerful, large, foreign to the codebase.

**Why.** Matching upstream means a reader of `Player.js` can read `Workspace.js`. The
constant table is so a typo in an event name is a lint or type error, not a listener
that silently never fires: `"frameChange"` is typed by hand in six files today.

### 2.5 Protocol messages are defined once and validated before they leave

**Decided 2026-10-21.** `src/js/protocol/` holds every message the display and surfaces
exchange: its name, its fields as a TypeScript type, a builder and a validator. Nothing
else constructs or posts a raw message; it calls the protocol module, which refuses a
malformed message. The build also emits a JSON Schema file from the types, published
from the protocol module: that is the language-neutral contract any later consumer
(another language, another team) validates against. Protocol Buffers is the upgrade
path if a non-JavaScript consumer with real traffic appears; a `.proto` is then
generated from the same definitions.

**Enforced.** `no-restricted-syntax` bans `postMessage` outside `src/js/protocol/`. Today
it finds 19 sites (16 in `presenter.js`, 3 in `player.js`), all replaced by the presenter
rewrite.

**Requirements for the protocol issue (#25), recorded 2026-10-21.** The receiver checks
the sender (origin for `postMessage`; the relay's own auth for the Worker) and dispatches
only from an explicit table of message names. Today the deck accepts a message from any
origin, posts to `"*"`, and its default branch calls whatever method the message names.

**Measured 2026-10-21.** 15 message names, built by hand in 19 places, listed nowhere, 0
origin checks. Minified runtime a validator library would add to the inlined player:
hand-written about 0.1 KB, `@bufbuild/protobuf` 26 KB, `protobufjs` 44 KB, `ajv` 125 KB.

**Alternatives.** (a) Post plain objects wherever needed, as today: fourteen message
names scattered across two files with no list anywhere. (b) Protocol Buffers now: a
`.proto`, Buf code generation in the gulp build, 26 KB in every deck, a binary encoding
that every hop (two windows, a JSON relay, an MCP server) decodes straight back into an
object; cross-language for consumers that do not exist yet. (c) A schema library (zod,
ajv) in the deck: a validator we would write anyway, plus the bytes.

**Why.** The protocol is the contract between the display, two transports, the PWA
shell, the relay Worker and the MCP server. Five consumers of one definition is the
only way they stay in agreement, and validating at the sender turns a wrong message
into a stack trace at the cause instead of a silent no-op at the receiver. The JSON
Schema is what makes the contract readable outside this codebase.

### 2.6 DOM: the player has no framework; presenter surfaces use Preact; no HTML from strings

**Decided 2026-10-21.** The **player** (inlined into every deck, 211 KB today) builds its
DOM with `<template>` elements in the nunjucks templates and a small `h()` helper, sets
text with `textContent`, and carries no framework. **Presenter surfaces** (the generated
presenter page, the PWA shell, anything in the channel repo) may use **Preact** with
TypeScript and JSX (11 KB minified); a surface that wants no framework is equally fine
(2.3). **Inferno stays in the editor**, which is upstream code outside the backlog; that
is the one deliberate case of two UI libraries in the repo, and it is not a cleanup.
HTML from data is parsed in exactly one module, `src/js/html/` (the Markdown renderer
of #24, whose output passes through DOMPurify); everywhere else it is a lint error.

**Enforced.** `no-restricted-properties` bans `innerHTML`, `outerHTML`,
`insertAdjacentHTML` and `document.write` outside `src/js/html/`; `no-restricted-syntax`
bans `dangerouslySetInnerHTML` there too. Today 11 sites in 6 files, four of them in
`presenter.js`, which assigns the frame title and the notes to `innerHTML`: a frame
titled `<img src=x onerror=…>` runs script in the presenter window. The cleanup moves
text to `textContent`; the presenter rewrite replaces the rest.

**Measured 2026-10-21 (minified, latest release).** Preact 11 KB (Oct 2026), Inferno
26 KB (Oct 2026), Lit 16 KB (May 2026). Neither template has a `<template>` element yet.

**Alternatives.** (a) Inferno in the presenter too: one library in the repo and the
editor views to copy from, but a hyperscript style models rarely write, and 26 KB.
(b) Lit: a third style, no example in the repo. (c) No framework in the presenter: the
panel workspace of #24 (move, resize, tab, minimise, per-device layouts) is UI rendered
from a layout state, which is exactly what a framework's render loop does. (d) Template
strings and `innerHTML`: the current presenter.

**Why.** Size and safety for the deck, which is a file people keep for years; fluency for
the surfaces, where Preact's React-shaped API is the dialect every model writes with the
fewest mistakes. And a presenter that renders notes as HTML has to be told exactly where
HTML is allowed, once.

### 2.7 Asynchrony and errors

**Decided 2026-10-21.** `async`/`await` everywhere; a promise is awaited or its failure
caught, never left floating; callbacks only where the DOM hands one over (an event
listener). Every timer and listener belongs to something with a `dispose()` (2.2).
Programmer errors throw a named `Error` subclass from `src/js/errors.ts`, never a bare
`new Error("…")`. Failures a presenter can act on (lost connection, bad pairing code) go
through the status API to a notice panel, never a blocking dialog. Logging is free (the
section 1 decision stands), but a `catch` whose only action is to log is a defect: the
failure is reported through the panel or rethrown.

**Enforced.** `no-restricted-globals` bans `alert`, `confirm` and `prompt` everywhere
(one site today, the presenter's popup warning). `@typescript-eslint/no-floating-promises`
(type-aware) makes an unawaited promise an error in `.ts` files. `no-empty` (recommended
set) already bans an empty `catch`. The error classes and the catch-that-only-logs rule
are prose; the notice panel is a deliverable of #24.

**Measured 2026-10-21.** 37 async functions and 85 awaits against 2 `.then` chains (both
without `.catch`) and 1 callback-style call: upstream is already most of the way there.
12 `throw new Error(string)`, 0 `Error` subclasses, 3 catches in the editor controller
that only `console.log`.

**Alternatives.** (a) Callback style throughout, as parts of `Storage.js` are: nesting,
and errors that go nowhere. (b) Promises with `.then` chains: the same thing `await`
does, with more ways to forget the `.catch`. (c) `alert()` for failures, as the
presenter does today: blocks the page during a talk. (d) `console` only in a logger
module: dropped in section 1; the defect is the swallowed error, not the log line.

**Why.** A presenter runs for an hour on a stage. Leaks (listeners never removed),
blocking dialogs, and errors swallowed into the console are the three ways it fails in
the room rather than in the test. `await` loses nothing over promises: it is the same
promise, read top to bottom, and `Promise.all` is still how parallel work is expressed.

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
