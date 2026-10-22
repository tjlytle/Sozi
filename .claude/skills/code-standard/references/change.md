# Change discipline (standard 5)

`npm run check:pr` checks the mechanical rules, and CI runs it on every PR.

- One issue, one branch named `<issue>-<slug>`, one PR whose body says `Closes #<issue>`.
- The PR matches the Implementation Plan; each departure is explained in the PR body's
  Plan section. Anything useful seen along the way is filed as an `idea` issue and
  listed under Ideas filed.
- The PR body follows `.github/PULL_REQUEST_TEMPLATE.md`: what changed, plan,
  dependencies, ideas filed, QA.
- A PR touches files only as far as its issue needs: no drive-by refactors, renames,
  reformatting or deletions. A cleanup issue is the sanctioned exception, scoped by its
  own issue.
- Commit subject imperative, the why in the body.
- `locales/messages.pot` and `yarn.lock` are rewritten by every gulp run; revert both
  before committing. The diff against the base must hold neither.
- A bug fix starts with a failing test.
- A protocol or API change stays backwards compatible for one release.
- Every commit, push, PR and comment goes through `gh-as <persona>`.
