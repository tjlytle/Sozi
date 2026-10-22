# JavaScript and TypeScript: shape and idiom (standard 2)

### 2.1 ES modules, named exports, one concern per module

- Every file is an ES module (`import`/`export`), tests included. No `require`.
- Exports are named. `export default` is a lint error (`import/no-default-export`);
  tool configs (`config/*.mjs`, `gulpfile.js`) are the exemption.
- Import cycles are a lint error (`import/no-cycle`).
- A **class module** has a PascalCase file name, one class, same name as the file
  (`model/Selection.js` exports `Selection`). A **function module** has a camelCase file
  name and related functions with no state between calls (`naming.js`).
- A file does not export two classes and does not mix a class with loose functions.
- No module-level mutable state: a file-level `const` whose value never changes is
  fine; a file-level `let`, or a `const` array or object that code pushes into, is a
  global. State lives in an instance or is passed in.

### 2.2 Classes for things with a lifetime, functions for things that compute

- Anything with state and a lifetime (a panel, a transport, the workspace, the display
  bridge) is a class. The constructor receives its dependencies. If it registers a
  listener or a timer, it has `dispose()` that removes every one it added.
- Anything that is a computation (matching notes to frames, choosing a layout preset,
  encoding a message) is a pure function in a function module, with no DOM access.
- `window`, `document` and `navigator` are lint errors in function modules
  (`no-restricted-globals`); the entry points listed in `config/eslintrc.mjs` are where
  the DOM is handed in.
- `dispose()` is proven by the class's unit test: create it with fakes, call
  `dispose()`, check the fakes have nothing registered.

### 2.3 Dependencies are passed in; the published API is the only global

- A class gets what it needs through its constructor. Each entry point has one wiring
  function that creates every object and hands each to the next.
- `window.sozi` and `window.sozi.presenter` are each assigned in exactly one module
  (`player.js`, `presenter.js`); assigning any other `window` property is a lint error.
- The deck never depends on a surface. Deck code (`player/`, `player.js`, `model/`,
  `svg/`) never imports a surface; a surface never imports deck internals; `protocol/`
  is the only module both share (`import/no-restricted-paths`).
- Add-ons, the presenter first among them, use the published API and never internals.
  If the API lacks something, the API grows.

### 2.4 Events: EventEmitter in the model, DOM events in the UI, names in one table

- State and model objects extend node's `EventEmitter`.
- Each emitter exports a constant table of its event names
  (`export const PlayerEvents = {frameChange: "frameChange"}`); every `on`, `once`,
  `off` and `emit` uses the table. A string literal as the event name is a lint error.
- UI code uses DOM events on elements.
- Electron and node glue lives in `src/js/**/*-electron.js` and
  `src/js/backend/Electron.js` and nowhere else; those files may subscribe to foreign
  event names. A third-party emitter elsewhere gets `eslint-disable-next-line` with the
  reason on the line.

### 2.5 Protocol messages are defined once and validated before they leave

- `src/js/protocol/` holds every message the display and surfaces exchange: its name,
  its fields as a TypeScript type, a builder and a validator.
- Nothing else constructs or posts a raw message; `postMessage` outside `protocol/` is
  a lint error. The protocol module refuses a malformed message.
- The build emits a JSON Schema from the types; that is the language-neutral contract.
- The receiver checks the sender (origin for `postMessage`; the relay's own auth for
  the Worker) and dispatches only from an explicit table of message names.

### 2.6 DOM: the player has no framework; presenter surfaces use Preact; no HTML from strings

- The player, inlined into every deck, builds its DOM with `<template>` elements and a
  small `h()` helper, sets text with `textContent`, and carries no framework.
- Presenter surfaces may use Preact with TypeScript and JSX; a surface with no
  framework is equally fine. Inferno stays in the editor and nowhere else.
- HTML from data is parsed in `src/js/html/` only, and its output passes through
  DOMPurify. `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` and
  `dangerouslySetInnerHTML` elsewhere are lint errors.

### 2.7 Asynchrony and errors

- `async`/`await` everywhere. A promise is awaited or its failure caught, never left
  floating (`no-floating-promises` in `.ts`). Callbacks only where the DOM hands one over.
- Every timer and listener belongs to something with `dispose()`.
- Programmer errors throw a named `Error` subclass from `src/js/errors.ts`, never a
  bare `new Error("…")`.
- Failures a presenter can act on go through the status API to the notice panel.
  `alert`, `confirm` and `prompt` are lint errors.
- Logging is free, but a `catch` whose only action is to log is a defect: report
  through the panel or rethrow.

### 2.8 Size, documentation, text, accessibility

- Size guidelines: 400 lines per file, 50 lines of code per function, ten public
  methods per class. The edit hook notes a file past one; splitting is your judgment.
- JSDoc with types on every export and public member in JavaScript; in TypeScript the
  summary sentence is still required on every exported function, class and method.
  When code changes under a comment that did not, the hook asks whether it still holds.
- Every user-visible string goes through `_()` from `i18n.js` (gettext; `jspot`
  extracts, Weblate translates). A string outside `_()` never reaches a translator.
- Controls are buttons, labelled and keyboard reachable; panels manage focus;
  animation honours `prefers-reduced-motion`. `eslint-plugin-jsx-a11y` runs on every
  `.tsx`/`.jsx` file; reduced motion is a browser scenario.
