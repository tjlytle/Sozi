# Tests and the QA evidence (standard 6)

### 6.1 Unit tests in node for every pure module and every class that takes fakes

- Node's built-in test runner (`node:test`), ES modules, no browser. `npm test`.
- Tests live under `test/` by kind (`cli/`, `hooks/`, `lint/`, `deps/`, `pr/`,
  `coverage/`, `pipeline/`, `standard/`, `features/`, and `unit/` for presenter
  modules).
- A unit test is named after the module it covers: `naming.test.js` covers `naming.js`.
  That name is how the coverage check finds it.
- Transports, protocol, notes matching, layout matching, timers: all unit-tested with
  fakes, no DOM.

### 6.2 Scenarios in Gherkin, run by Cucumber with Playwright in Chromium

- Acceptance criteria are Given/When/Then scenarios in `test/features/`, run by
  `npm run test:features` against the built presenter and display.
- The feature file is the human-readable test plan: it opens with prose, then the
  scenarios. Step definitions in `test/features/steps/` are the stored, deterministic
  test: written once, checked in, rerun by CI, never regenerated.
- Files are organised by what they describe (`presenter/previews.feature`,
  `presenter/notes.feature`, `display/api.feature`), not by issue. Each scenario is
  tagged with its issue (`@issue-25`).
- The first line of a feature file is `# covers: <paths>` (files or directories).
  `npm run check:coverage` reads it; the edit hook and CI ask when a source file has no
  covering test, and when a test and the code it covers change together.
- An uncovered source file fails CI unless the PR body says
  `No test: <path> - <reason>`.
- The template to copy: `test/features/presenter/previews.feature`, with support code
  in `test/features/support/world.js`.

### 6.3 What QA posts on the PR

- One comment on every PR: the CI link and the scenarios that ran, by name.
- When the change is visual (a panel, a template, CSS): a screenshot from the scenario
  run, uploaded with `node bin/evidence.js put <file>`, and a phone-width one when the
  narrow layout is affected.
- For a protocol or API change: the doc diff.
- A PR without a QA comment is not ready. That comment is QA's approval.

### 6.4 CI is the gate, master is the branch, the loop stops only for a real question

- A PR merges when every CI job that is green on master is green on the PR and the
  reviewer has approved. QA merges as builder with `gh-as builder pr merge --squash
  --delete-branch`.
- Every merge to master builds the Electron app, the scenario report and the presenter
  page as artifacts.
- The loop parks an issue for a person for a mechanical blocker only. A question is
  answered by the persona that meets it, recorded, with the road not taken filed as an
  `idea` issue.

### 6.5 Bias toward merging: a PR is held only for a defect, everything else is a new issue

- Review and QA send a PR back for three things: it misses an acceptance criterion; it
  breaks this standard in a way CI cannot catch (a dependency not in the plan, data
  through `innerHTML`, a second global, a protocol change outside `src/js/protocol/`);
  it introduces a security or data-loss problem.
- A simple nit (a name, a typo, a missing JSDoc line, a one-line edge case inside the
  acceptance criteria) is fixed in the same PR.
- Anything larger becomes its own issue with the `idea` label and no stage label, body
  starting "Seen while reviewing #<pr>:". The PR merges on its own merits.
- A failing scenario is a defect and goes back; something noticed outside the
  scenarios is an issue.

### 6.6 Tests first, written by someone other than the builder

- After the plan, QA writes the feature file from the plan's Scenarios heading, with the
  step definitions it needs, on the issue branch; runs it; sees it fail; pushes; hands
  the issue to the builder. QA does not touch `src/`.
- The builder makes those scenarios green and never creates the feature file (it may
  add a missing step definition).
- Inside the build, each unit test is written before the function it pins, and the red
  run of `npm test` is pasted in the PR body.
- A test and the code it covers arriving in one commit is something the reviewer asks
  about.
