# Software factory for the Sozi fork

The plan for letting an agent pipeline work the presenter backlog (#24 and its children,
plus sozi-channel #7-9) without a person reading every line of JavaScript. Written
2026-10-20 after the interview; the snake demo repo (`tjlytle/techbash-snake`) is the
template.

## How to continue this (read first)

Tim is not fluent in the JavaScript, CSS and Electron that Sozi is built on, and wants to
define the rules interactively rather than approve a document. So the standard in
`code-standard.md` is an agenda, not a decision. Work through it one section at a time, in
order, and for each section:

1. Explain the concept in plain terms before the rule: what an ES module is, what
   Prettier does that ESLint does not, why the player has no framework, what a custom
   property is in CSS. Show the thing in this repo (`src/js/presenter.js`, a CSS file, the
   gulp build) so the rule is about code he can see, not an abstraction.
2. Put the choice and the alternatives in front of him and let him decide. The draft's
   "why" is the recommendation, not the answer.
3. Write the decision back into `code-standard.md` and, where it is enforceable, into the
   tool config at the same time, so the rule and its enforcement never drift.
4. Note anything he asks that the draft did not anticipate; those become rules too.

Only after the standard is his does the foundation PR start.

**Status 2026-10-20:** section 1 (mechanics) is agreed and enforced: `.prettierrc.json`,
`config/eslintrc.mjs`, `tsconfig.json` + `tsconfig.checkjs.json`, `config/stylelintrc.json`,
`bin/check` (= `npm run check`), the edit hook `.claude/hooks/check-file.py` with its test,
and `.github/workflows/ci.yml`. Every check is red on the existing code by design (see
"Cleanups" in the standard); the one-time fixes are the factory's first issues. Sections 2.1 to 2.4 are agreed too. Next: section 2.5, protocol messages. Things Tim asked that the draft did not anticipate: what a lint
rule's name means (decode it word by word, with a PHP example); whether to migrate to
TypeScript (yes, gradually); "nightly" meant "a build per merge".

## What has to be true before the loop runs unattended

1. **One code standard, enforced by tools, not by prompts.** `code-standard.md` in this
   directory. Every rule says what we choose, the alternatives, and why. Prettier, ESLint,
   `tsc --checkJs` and Stylelint enforce the mechanical half; the rest is written so any
   model produces the same shape.
2. **CI is the gate.** GitHub Actions on every PR: format check, lint, types, unit tests,
   browser scenarios, build. All required. Green PRs merge to `master` on their own; CI
   builds the Electron app and the hosted shell on every merge so there is always a build
   to click through that is exactly master. No nightly branch.
3. **Evidence you can read instead of the code.** Acceptance criteria in the issue are
   Gherkin scenarios in `test/features/<issue>.feature`, run by Cucumber with Playwright.
   QA posts one comment per PR: CI link, scenario names, laptop and phone screenshots on
   every UI PR, the doc diff for any protocol or API change.
4. **The loop stops for a person in two cases only.** A question the issue, the plan and
   the standard do not answer; or an architectural decision they do not settle (a new
   dependency not in the plan, a new transport, a protocol or published-API change).
   Everything else is decided by the standard and checked by CI.
5. **Bias toward merging.** Review and QA hold a PR for a defect only. A simple nit is
   fixed in the PR. Anything bigger becomes its own `idea` issue and goes through the
   process.

## The pipeline, ported from the snake

- **Stage labels:** `stage:todo`, `stage:planned`, `stage:in-progress`, `stage:review`,
  `stage:qa`, `stage:done`, `stage:parked`; `idea` for unpromoted suggestions; `working`
  while a stage holds an issue. A GitHub project board mirrors the labels.
- **Personas:** advocate (writes the issue up), architect (Implementation Plan as a
  comment), builder (branch, PR), reviewer (approve or request changes), qa (scenarios,
  evidence, merge), ops (the loop itself). All writes through `gh-as <persona>`; the
  `Bots:` line in `CLAUDE.md` maps them. The repo lock hook denies any write that is not
  on `tjlytle/Sozi`.
- **Prompts** in `pipeline/*.md`, one per stage; `bin/pipeline` runs one headless pass per
  stage with the allow list in `pipeline/allow.txt`. Tim starts and stops the loop.
- **Policy lines in `CLAUDE.md`:** `Merge: auto`, `Plans: auto`, `Promote ideas: no`.
- **Models:** plan on the most capable model, the rest on the standard one.
- **Lessons from the talk already folded in:** QA tests the branch merged with master,
  not alone (parallel green branches broke main together); the loop backs off when idle
  instead of polling the board every 30 s.

## Order of work

1. **Foundation PR on the fork** (this plan's first deliverable):
   - `CLAUDE.md`: point at the standard, add the policy lines and the parking rules.
   - Tool configs: Prettier, ESLint additions, `tsc` with `--checkJs`, Stylelint
     replacing csslint; scoped to our files, upstream files untouched.
   - `.github/workflows/ci.yml` with every check; build artifacts on every merge.
   - `test/unit/` and `test/features/` scaffold with one real scenario against the
     built presenter, so the first real PR has something to copy.
   - Stage labels, the project board, `pipeline/*.md`, `bin/pipeline`, `pipeline/allow.txt`.
2. **Same shape on `tjlytle/sozi-channel`**, plus a preview Worker deployment per merge.
3. **Run the backlog.** Tim starts the loop; the first issues are the presenter epic's
   leaves (#25 protocol and transport interface first, since everything else depends on
   it). Tim's job is the parked issues and the screenshots.
4. **Later, with evidence:** triage before planning with a decision model (Jev or Clef),
   see the Future section of the standard.

## What Tim decided in the interview

Concrete standards over model judgment; idiomatic to the language and the app, not
PHP-flavoured; base is `master` with the CLI stack merged; CI over nightly; auto-merge and
auto-plans with the two parking cases; screenshots on every UI PR; the channel repo gets
the same standard and pipeline; merge bias with improvements filed as issues.
